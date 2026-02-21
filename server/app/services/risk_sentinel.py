from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from app.core.schemas import RiskJSON, RiskUpdateLLMResponse, SegmentJSON
from app.services.llm_client import BaseLLMClient, LLMError, MockLLMClient

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "risk_check.md"
DISCLAIMER = "For demo only. Not medical advice."
DEFAULT_FOLLOWUPS = [
    "When did these symptoms start?",
    "How have these symptoms changed over time?",
]
logger = logging.getLogger(__name__)


ASSESSMENT_PATTERN = re.compile(
    r"(?:possible|concern for|rule out|cannot rule out|impression(?:\s+is)?|"
    r"differential(?:\s+diagnosis)?\s+includes?)\s+([^.;\n]+)",
    flags=re.IGNORECASE,
)
URGENT_ACTION_HINTS = (
    "urgent",
    "emergency department",
    "ed evaluation",
    "go right away",
    "immediately",
    "call 911",
)
HIGH_ACUITY_CUES = (
    "chest pain",
    "shortness of breath",
    "dyspnea",
    "slurred speech",
    "one-sided weakness",
    "faint",
    "syncope",
    "severe bleeding",
    "can't breathe",
    "cannot breathe",
)
MODERATE_ACUITY_CUES = (
    "fever",
    "cough",
    "persistent vomiting",
    "headache",
    "dizziness",
    "palpitations",
    "tachycardia",
)
SYMPTOM_CUES = (
    "pain",
    "fever",
    "cough",
    "shortness of breath",
    "dizzy",
    "dizziness",
    "weakness",
    "numbness",
    "faint",
    "headache",
    "nausea",
    "vomit",
    "bleeding",
    "confusion",
    "palpitations",
    "sweaty",
    "chills",
)
MAX_CANDIDATES = 6


class RiskSentinel:
    def __init__(self, llm_client: BaseLLMClient) -> None:
        self._llm_client = llm_client
        self._system_prompt = PROMPT_PATH.read_text(encoding="utf-8")

    async def update(
        self,
        *,
        new_segments: list[SegmentJSON],
        all_segments: list[SegmentJSON],
    ) -> RiskUpdateLLMResponse:
        transcript_window = all_segments[-30:]
        candidates = _transcript_driven_candidates(new_segments if new_segments else transcript_window)
        if not candidates:
            return RiskUpdateLLMResponse(risks=[])

        if isinstance(self._llm_client, MockLLMClient):
            return RiskUpdateLLMResponse(risks=_heuristic_risks(candidates))

        user_prompt = (
            "Risk candidates derived from the conversation transcript:\n"
            f"{json.dumps(candidates, indent=2)}\n\n"
            "Recent transcript segments:\n"
            f"{json.dumps([segment.model_dump(mode='json') for segment in transcript_window], indent=2)}\n\n"
            "Confirm/deny each candidate and return only supported clinical risks."
        )

        try:
            result = await self._llm_client.generate_json(
                system_prompt=self._system_prompt,
                user_prompt=user_prompt,
                schema=RiskUpdateLLMResponse,
            )
            return RiskUpdateLLMResponse(risks=_sanitize_risks(result.risks, all_segments))
        except LLMError as exc:
            logger.warning("Risk LLM unavailable; using heuristic fallback: %s", exc)
            return RiskUpdateLLMResponse(risks=_heuristic_risks(candidates))


def _transcript_driven_candidates(segments: list[SegmentJSON]) -> list[dict]:
    merged: dict[str, dict] = {}
    for segment in segments:
        for candidate in _extract_candidates_from_segment(segment):
            label = candidate["label"].strip()
            if not label:
                continue
            key = label.lower()
            existing = merged.get(key)
            if existing is None:
                merged[key] = {
                    "label": label,
                    "severity_hint": int(candidate.get("severity_hint", 3)),
                    "followup_hints": _dedupe_followups(candidate.get("followup_hints", [])),
                    "evidence_segment_ids": sorted(set(candidate.get("evidence_segment_ids", []))),
                }
            else:
                existing["severity_hint"] = max(
                    int(existing.get("severity_hint", 3)),
                    int(candidate.get("severity_hint", 3)),
                )
                evidence = set(existing.get("evidence_segment_ids", []))
                evidence.update(candidate.get("evidence_segment_ids", []))
                existing["evidence_segment_ids"] = sorted(evidence)
                followups = list(existing.get("followup_hints", [])) + list(candidate.get("followup_hints", []))
                existing["followup_hints"] = _dedupe_followups(followups)

    ranked = sorted(
        merged.values(),
        key=lambda item: (int(item.get("severity_hint", 1)), len(item.get("evidence_segment_ids", []))),
        reverse=True,
    )
    return ranked[:MAX_CANDIDATES]


def _extract_candidates_from_segment(segment: SegmentJSON) -> list[dict]:
    text = _normalize_space(segment.text)
    lowered = text.lower()
    candidates: list[dict] = []

    for match in ASSESSMENT_PATTERN.finditer(text):
        phrase = _clean_phrase(match.group(1))
        if not phrase:
            continue
        candidates.append(
            {
                "label": f"Possible {phrase}",
                "severity_hint": _estimate_severity(text, phrase),
                "followup_hints": _build_followups(phrase),
                "evidence_segment_ids": [segment.id],
            }
        )

    if any(token in lowered for token in URGENT_ACTION_HINTS):
        candidates.append(
            {
                "label": "Needs urgent in-person evaluation",
                "severity_hint": 5,
                "followup_hints": [
                    "Are symptoms worsening right now?",
                    "Do you have chest pain, breathing trouble, or fainting currently?",
                    "Can you seek emergency care immediately?",
                ],
                "evidence_segment_ids": [segment.id],
            }
        )

    if any(token in lowered for token in SYMPTOM_CUES):
        topic = _extract_symptom_topic(text)
        candidates.append(
            {
                "label": f"Concerning symptom report: {topic}",
                "severity_hint": _estimate_severity(text, topic),
                "followup_hints": _build_followups(topic),
                "evidence_segment_ids": [segment.id],
            }
        )

    return _dedupe_segment_candidates(candidates)


def _dedupe_segment_candidates(candidates: list[dict]) -> list[dict]:
    deduped: dict[str, dict] = {}
    for candidate in candidates:
        label = str(candidate.get("label", "")).strip()
        if not label:
            continue
        key = label.lower()
        existing = deduped.get(key)
        if existing is None:
            deduped[key] = candidate
            continue
        existing["severity_hint"] = max(
            int(existing.get("severity_hint", 3)),
            int(candidate.get("severity_hint", 3)),
        )
        evidence = set(existing.get("evidence_segment_ids", []))
        evidence.update(candidate.get("evidence_segment_ids", []))
        existing["evidence_segment_ids"] = sorted(evidence)
        followups = list(existing.get("followup_hints", [])) + list(candidate.get("followup_hints", []))
        existing["followup_hints"] = _dedupe_followups(followups)
    return list(deduped.values())


def _dedupe_followups(followups: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for followup in followups:
        cleaned = followup.strip()
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
    return result[:5]


def _normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _clean_phrase(raw: str) -> str:
    text = _normalize_space(raw.strip(":-, "))
    if not text:
        return ""
    text = re.sub(
        r"^(possible|concern for|rule out|cannot rule out)\s+",
        "",
        text,
        flags=re.IGNORECASE,
    )
    lowered = text.lower()
    for separator in (" but ", " and ", ","):
        idx = lowered.find(separator)
        if idx > 0:
            text = text[:idx].strip()
            lowered = text.lower()
    text = re.sub(r"^(a|an|the)\s+", "", text, flags=re.IGNORECASE)
    words = text.split()
    if not words:
        return ""
    return " ".join(words[:8])


def _extract_symptom_topic(text: str) -> str:
    match = re.search(
        r"(?:patient:\s*)?(?:i(?:'ve)?\s+(?:have|had|feel|am)|my)\s+([^.;\n]+)",
        text,
        flags=re.IGNORECASE,
    )
    candidate = match.group(1) if match else text
    topic = _clean_phrase(candidate)
    return topic or "reported symptoms"


def _estimate_severity(text: str, topic: str) -> int:
    combined = f"{text} {topic}".lower()
    if any(cue in combined for cue in HIGH_ACUITY_CUES):
        return 5
    if any(cue in combined for cue in MODERATE_ACUITY_CUES):
        return 4
    if any(token in combined for token in ("possible", "concern for", "worsening", "progressive")):
        return 3
    return 2


def _build_followups(topic: str) -> list[str]:
    phrase = _clean_phrase(topic).lower()
    if not phrase:
        phrase = "these symptoms"
    return [
        f"When did {phrase} start?",
        f"How has {phrase} changed over time?",
        f"What makes {phrase} better or worse?",
    ]


def _heuristic_risks(candidates: list[dict]) -> list[RiskJSON]:
    risks: list[RiskJSON] = []
    for candidate in candidates:
        followups = _dedupe_followups([str(item) for item in candidate.get("followup_hints", [])])
        if len(followups) < 2:
            followups.extend(DEFAULT_FOLLOWUPS[: 2 - len(followups)])
        risks.append(
            RiskJSON(
                label=candidate["label"],
                severity=max(1, min(5, int(candidate.get("severity_hint", 3)))),
                rationale="Derived from conversation transcript evidence.",
                followups=followups[:5],
                evidence_segment_ids=list(candidate.get("evidence_segment_ids", [])),
                disclaimer=DISCLAIMER,
            )
        )
    return risks


def _sanitize_risks(risks: list[RiskJSON], all_segments: list[SegmentJSON]) -> list[RiskJSON]:
    valid_ids = {segment.id for segment in all_segments}
    sanitized: list[RiskJSON] = []
    for risk in risks:
        evidence_ids = [segment_id for segment_id in risk.evidence_segment_ids if segment_id in valid_ids]
        followups = [question.strip() for question in risk.followups if question.strip()][:5]
        if len(followups) < 2:
            followups.extend(DEFAULT_FOLLOWUPS[: 2 - len(followups)])
        sanitized.append(
            RiskJSON(
                label=risk.label.strip(),
                severity=risk.severity,
                rationale=risk.rationale.strip(),
                followups=followups,
                evidence_segment_ids=evidence_ids,
                disclaimer=risk.disclaimer or DISCLAIMER,
            )
        )
    return sanitized

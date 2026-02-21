from __future__ import annotations

import json
import logging
from pathlib import Path

from app.core.schemas import CitationJSON, SegmentJSON, SoapNoteJSON, SoapUpdateLLMResponse
from app.services.llm_client import BaseLLMClient, LLMError, MockLLMClient

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "soap_update.md"
logger = logging.getLogger(__name__)


class SoapUpdater:
    def __init__(self, llm_client: BaseLLMClient) -> None:
        self._llm_client = llm_client
        self._system_prompt = PROMPT_PATH.read_text(encoding="utf-8")

    async def update(
        self,
        *,
        previous_soap: SoapNoteJSON,
        new_segments: list[SegmentJSON],
        all_segments: list[SegmentJSON] | None = None,
    ) -> SoapUpdateLLMResponse:
        if not new_segments:
            return SoapUpdateLLMResponse(soap=previous_soap, citations=[])

        if isinstance(self._llm_client, MockLLMClient):
            return _heuristic_soap_update(previous_soap, new_segments)

        segment_payload = [segment.model_dump(mode="json") for segment in new_segments]
        user_prompt = (
            "Current SOAP JSON:\n"
            f"{previous_soap.model_dump_json(indent=2)}\n\n"
            "New final transcript segments (id, text, timestamps):\n"
            f"{json.dumps(segment_payload, indent=2)}\n\n"
            "Return updated SOAP and citations as strict JSON."
        )

        try:
            result = await self._llm_client.generate_json(
                system_prompt=self._system_prompt,
                user_prompt=user_prompt,
                schema=SoapUpdateLLMResponse,
            )
        except LLMError as exc:
            logger.warning("SOAP LLM unavailable; using heuristic fallback: %s", exc)
            return _heuristic_soap_update(previous_soap, new_segments)

        valid_ids = {segment.id for segment in (all_segments or new_segments)}
        sanitized_citations = _sanitize_citations(result.citations, result.soap, valid_ids)
        return SoapUpdateLLMResponse(soap=result.soap, citations=sanitized_citations)


def _heuristic_soap_update(previous_soap: SoapNoteJSON, new_segments: list[SegmentJSON]) -> SoapUpdateLLMResponse:
    soap = previous_soap.model_copy(deep=True)
    citations: list[CitationJSON] = []

    for segment in new_segments:
        target_section = _classify_section(segment.text)
        section_items = getattr(soap, target_section)
        bullet = segment.text.strip()
        if not bullet:
            continue
        if bullet in section_items:
            continue

        section_items.append(bullet)
        if len(section_items) > 6:
            section_items[:] = section_items[-6:]

        bullet_index = len(section_items) - 1
        citations.append(
            CitationJSON(
                note_path=f"{target_section}[{bullet_index}]",
                segment_ids=[segment.id],
                quote=_short_quote(segment.text),
            )
        )

    return SoapUpdateLLMResponse(soap=soap, citations=citations)


def _classify_section(text: str) -> str:
    normalized = text.lower()
    if any(token in normalized for token in ("blood pressure", "heart rate", "temperature", "exam", "o2", "pulse")):
        return "objective"
    if any(token in normalized for token in ("likely", "possible", "concern for", "impression")):
        return "assessment"
    if any(token in normalized for token in ("plan", "start", "order", "prescribe", "follow up", "recommend")):
        return "plan"
    return "subjective"


def _short_quote(text: str) -> str:
    words = text.strip().split()
    return " ".join(words[:15])


def _sanitize_citations(
    citations: list[CitationJSON], soap: SoapNoteJSON, valid_segment_ids: set[int]
) -> list[CitationJSON]:
    valid_paths: set[str] = set()
    for section_name in ("subjective", "objective", "assessment", "plan"):
        bullets = getattr(soap, section_name)
        for idx in range(len(bullets)):
            valid_paths.add(f"{section_name}[{idx}]")

    cleaned: list[CitationJSON] = []
    for citation in citations:
        if citation.note_path not in valid_paths:
            continue
        filtered_ids = [segment_id for segment_id in citation.segment_ids if segment_id in valid_segment_ids]
        cleaned.append(
            CitationJSON(
                note_path=citation.note_path,
                segment_ids=filtered_ids,
                quote=citation.quote,
            )
        )
    return cleaned

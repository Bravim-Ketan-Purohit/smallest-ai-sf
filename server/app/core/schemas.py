from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SegmentJSON(BaseModel):
    id: int
    text: str
    start_ms: int | None = None
    end_ms: int | None = None


class SoapNoteJSON(BaseModel):
    subjective: list[str] = Field(default_factory=list)
    objective: list[str] = Field(default_factory=list)
    assessment: list[str] = Field(default_factory=list)
    plan: list[str] = Field(default_factory=list)


class CitationJSON(BaseModel):
    note_path: str
    segment_ids: list[int] = Field(default_factory=list)
    quote: str | None = None


class RiskJSON(BaseModel):
    label: str
    severity: Literal[1, 2, 3, 4, 5]
    rationale: str
    followups: list[str] = Field(default_factory=list, min_length=2, max_length=5)
    evidence_segment_ids: list[int] = Field(default_factory=list)
    disclaimer: str = "For demo only. Not medical advice."


class TaskJSON(BaseModel):
    text: str
    done: bool = False


class STTPartialPayload(BaseModel):
    text: str
    confidence: float | None = None
    session_id: str


class STTFinalPayload(BaseModel):
    segment: SegmentJSON
    session_id: str


class SoapUpdatePayload(BaseModel):
    soap: SoapNoteJSON
    citations: list[CitationJSON] = Field(default_factory=list)
    session_id: str


class RiskUpdatePayload(BaseModel):
    risks: list[RiskJSON] = Field(default_factory=list)
    session_id: str


class StatusPayload(BaseModel):
    state: Literal["idle", "recording", "processing", "error"]
    message: str


class ErrorPayload(BaseModel):
    code: str
    message: str


class EventEnvelope(BaseModel):
    type: Literal["STT_PARTIAL", "STT_FINAL", "SOAP_UPDATE", "RISK_UPDATE", "STATUS", "ERROR"]
    ts: datetime
    payload: dict


class SoapUpdateLLMResponse(BaseModel):
    soap: SoapNoteJSON
    citations: list[CitationJSON] = Field(default_factory=list)


class RiskUpdateLLMResponse(BaseModel):
    risks: list[RiskJSON] = Field(default_factory=list)


class DemoSeedRequest(BaseModel):
    lines: list[str] = Field(default_factory=list)

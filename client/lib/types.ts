export type EventType =
  | "STT_PARTIAL"
  | "STT_FINAL"
  | "SOAP_UPDATE"
  | "RISK_UPDATE"
  | "STATUS"
  | "ERROR";

export interface Segment {
  id: number;
  text: string;
  start_ms: number | null;
  end_ms: number | null;
}

export interface SoapNote {
  subjective: string[];
  objective: string[];
  assessment: string[];
  plan: string[];
}

export interface Citation {
  note_path: string;
  segment_ids: number[];
  quote?: string | null;
}

export interface Risk {
  label: string;
  severity: 1 | 2 | 3 | 4 | 5;
  rationale: string;
  followups: string[];
  evidence_segment_ids: number[];
  disclaimer: string;
}

export interface StatusPayload {
  state: "idle" | "recording" | "processing" | "error";
  message: string;
}

export interface EventEnvelope {
  type: EventType;
  ts: string;
  payload: unknown;
}

export const EMPTY_SOAP: SoapNote = {
  subjective: [],
  objective: [],
  assessment: [],
  plan: [],
};

# PulseScribe

Ambient Scribe + Risk Sentinel for clinical conversations.  
Speak once, get a structured SOAP note, risk signals, and transcript-backed evidence in near real-time.

## Introduction

PulseScribe is a hackathon MVP built around a practical wedge:

1. Capture a live doctor-patient conversation.
2. Transcribe it in real time.
3. Continuously generate a clinician-style SOAP note.
4. Surface risks with follow-up questions and linked transcript evidence.

This repo prioritizes demo reliability and observability while keeping the backend architecture clean and scalable.

## Demo Video

- YouTube demo: [https://www.youtube.com/watch?v=7Z_5_qPwq7Y](https://www.youtube.com/watch?v=7Z_5_qPwq7Y)

[![Watch the PulseScribe demo on YouTube](https://img.youtube.com/vi/7Z_5_qPwq7Y/maxresdefault.jpg)](https://youtu.be/7Z_5_qPwq7Y?si=GeROeyktlPx4sLDE)

- Note: GitHub README does not support true inline video embed from YouTube, but this thumbnail gives a one-click play flow.

## Why Smallest STT In This Build

This app uses **Smallest Waves Pulse STT** for speech-to-text (STT).  
Note: this project does not use Smallest TTS in the core flow.

Why it fit this implementation:

- Supports both **real-time WebSocket streaming** and **pre-recorded HTTP upload** on the same Pulse API family.
- Realtime setup is straightforward: `wss://waves-api.smallest.ai/api/v1/pulse/get_text` with Bearer auth.
- Useful transcript controls for this product shape:
  - `full_transcript=true` for cumulative context.
  - `word_timestamps=true` for evidence mapping.
- The realtime docs explicitly support an end signal (`{"type":"end"}`), which matches our session finalization flow.
- Quickstart documentation advertises low TTFT behavior for live transcription use cases.

This kept the integration lean while still enabling production-like demo behavior.

## Core Architecture (App Flow)

This section describes the core app event loop (excluding the optional ops dashboard internals).

```text
Browser (Mic / Live Demo Audio)
    -> WS /ws/audio (FastAPI)
        -> Smallest Pulse STT WS
            -> STT_PARTIAL / STT_FINAL
                -> SessionState (in-memory)
                    -> Batching Manager (timer + threshold)
                        -> SOAP Updater + Risk Sentinel (LLM)
                            -> SOAP_UPDATE / RISK_UPDATE
                                -> WS /ws/events -> UI Panels
```

### Backend responsibilities

- `server/app/ws/audio_ws.py`: receives client audio frames and finalize signals.
- `server/app/services/smallest_stt.py`: bridges audio to Smallest realtime WS and emits transcript events.
- `server/app/core/session_state.py`: per-session state registry + concurrency locks.
- `server/app/core/batching.py`: non-blocking interval/threshold triggers for LLM updates.
- `server/app/services/soap_updater.py`: strict JSON SOAP generation + citations.
- `server/app/services/risk_sentinel.py`: transcript-driven risk extraction + LLM validation.
- `server/app/ws/events_ws.py`: pushes protocol events to frontend subscribers.

### Frontend responsibilities

- `client/lib/usePulseScribe.ts`: websocket orchestration + realtime state updates.
- `client/components/*`: transcript, SOAP, risk panels, and evidence interaction.
- `client/app/page.tsx`: single-screen demo surface.

## Execution Flow (Live Demo)

When you click `Play live demo (real APIs)`:

1. UI opens `/ws/audio` and `/ws/events`.
2. Selected demo audio (`convo` or `convo_short`) streams to backend.
3. Backend forwards PCM chunks to Smallest Pulse realtime WS.
4. Partial/final STT segments are published to UI immediately.
5. Batcher triggers SOAP/risk updates (~12s or segment threshold).
6. UI receives `SOAP_UPDATE` + `RISK_UPDATE`.
7. Evidence highlights map note/risk items to transcript segments.

## Features

- Real-time transcription pipeline (Smallest Pulse WS).
- Incremental SOAP note generation with strict schema validation.
- Transcript-driven risk detection with severity + follow-up questions.
- Evidence mapping (note/risk -> transcript segment IDs).
- Dual demo modes:
  - `Play live demo (real APIs)` for full realtime pipeline.
  - `Play seeded demo (no API cost)` for deterministic fallback demos.
- Live script selector: `convo` and `convo_short`.
- Loud playback toggle for live demo (`Audio out loud: ON/OFF`, default ON).
- Single-screen API ops observability:
  - live status cards for events/audio/STT/SOAP/risk
  - event timeline with state transitions and errors
- Failure resilience:
  - transcription continues if LLM fails/rate-limits
  - fallback heuristic note/risk generation when needed.

## Project Structure

```text
server/
  app/
    main.py
    ws/
      audio_ws.py
      events_ws.py
    services/
      smallest_stt.py
      llm_client.py
      soap_updater.py
      risk_sentinel.py
    core/
      session_state.py
      schemas.py
      batching.py
      config.py
    prompts/
      soap_update.md
      risk_check.md

client/
  app/
  components/
  lib/

scripts/
  record_demo_audio.sh
  upload_demo_to_smallest.sh
```

## Prerequisites

- Python 3.10+
- Node.js 20+
- API keys:
  - `SMALLEST_API_KEY` (required)
  - `LLM_API_KEY` (if `LLM_PROVIDER=openai`)

## Environment Setup

### Server

```bash
cp server/.env.example server/.env
```

Required server variables:

- `SMALLEST_API_KEY`
- `LLM_PROVIDER` (`openai` or fallback mock behavior)
- `LLM_API_KEY`
- `LLM_MODEL` (e.g. `gpt-4o-mini`)
- `LLM_RATE_LIMIT_COOLDOWN_SECONDS` (optional, default `30`)
- `ALLOWED_ORIGINS` (default `http://localhost:3000`)

### Client

```bash
cp client/.env.example client/.env.local
```

Defaults:

- `NEXT_PUBLIC_BACKEND_HTTP_URL=http://localhost:8000`
- `NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:8000`

Never place secrets in `NEXT_PUBLIC_*`.

## Run Locally

### 1) Backend

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2) Frontend

```bash
cd client
npm install
npm run dev
```

Open: `http://localhost:3000`

## Demo Modes (No Mic Needed)

### Live API run (recommended for judging)

1. Choose script: `convo` or `convo_short`.
2. Keep `Audio out loud: ON` (default) if you want audience playback.
3. Click `Play live demo (real APIs)`.

### Seeded run (offline-safe fallback)

- Click `Play seeded demo (no API cost)`.
- Uses scripted transcript injection and heuristic updates.

### Terminal helpers

- Record custom demo audio:

```bash
./scripts/record_demo_audio.sh client/public/demo/demo-conversation.wav 35 0
```

- Validate real Smallest pre-recorded API call:

```bash
./scripts/upload_demo_to_smallest.sh server/demo_conv.mp3 en
```

## Event Protocol (Frontend <- Backend)

Envelope:

```json
{
  "type": "EVENT_TYPE",
  "ts": "ISO8601",
  "payload": {}
}
```

Implemented event types:

- `STT_PARTIAL`
- `STT_FINAL`
- `SOAP_UPDATE`
- `RISK_UPDATE`
- `STATUS`
- `ERROR`

## Practical Use Cases

- Ambient clinical documentation for outpatient and urgent-care workflows.
- Faster first-pass notes for telehealth and virtual triage.
- Real-time risk prompting during symptom review.
- Training/simulation review with transcript-backed evidence.

## Future Product Extensions

- Auto-generate billing/coding suggestions (ICD-10/CPT) from structured note context.
- Medication/allergy normalization with interaction flags.
- Procedure-specific templates and specialty-specific SOAP styles.
- QA analytics: missing-history checks, red-flag compliance prompts.
- EHR integration adapters and encounter export.
- Human-in-the-loop approval workflow with audit trails.

## Notes

- LLM failures are non-blocking; transcription path remains live.
- API keys are server-side only.
- Audio ingest path is isolated from LLM calls to keep the loop responsive.

## Safety

For demo only. Not medical advice.

## Source References

- Waves STT Overview: https://waves-docs.smallest.ai/v4.0.0/content/speech-to-text/overview
- Realtime STT Quickstart: https://waves-docs.smallest.ai/v4.0.0/content/speech-to-text/realtime/quickstart
- Realtime Full Transcript: https://waves-docs.smallest.ai/v4.0.0/content/speech-to-text/features/full-transcript
- Pre-recorded STT Quickstart: https://waves-docs.smallest.ai/v4.0.0/content/speech-to-text/pre-recorded/quickstart
- Word Timestamps: https://waves-docs.smallest.ai/v4.0.0/content/speech-to-text/features/word-timestamps
- Speech AI platform intro: https://waves-docs.smallest.ai/

from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.session_state import SessionState, session_registry, utc_now

router = APIRouter()


@router.websocket("/ws/events")
async def events_ws(websocket: WebSocket) -> None:
    session_id = websocket.query_params.get("session_id")
    if not session_id:
        await websocket.close(code=1008, reason="session_id is required")
        return

    await websocket.accept()
    state = await session_registry.subscribe(session_id, websocket)

    await _send_initial_snapshot(websocket, state)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await session_registry.unsubscribe(session_id, websocket)


async def _send_initial_snapshot(websocket: WebSocket, state: SessionState) -> None:
    status_state = "recording" if state.stt_connected else "idle"
    await websocket.send_json(
        {
            "type": "STATUS",
            "ts": utc_now().isoformat(),
            "payload": {
                "state": status_state,
                "message": "Events connected",
            },
        }
    )

    for segment in state.transcript_segments:
        await websocket.send_json(
            {
                "type": "STT_FINAL",
                "ts": utc_now().isoformat(),
                "payload": {
                    "segment": segment.to_json().model_dump(mode="json"),
                    "session_id": state.session_id,
                },
            }
        )

    if state.partial_transcript:
        await websocket.send_json(
            {
                "type": "STT_PARTIAL",
                "ts": utc_now().isoformat(),
                "payload": {
                    "text": state.partial_transcript,
                    "confidence": None,
                    "session_id": state.session_id,
                },
            }
        )

    await websocket.send_json(
        {
            "type": "SOAP_UPDATE",
            "ts": utc_now().isoformat(),
            "payload": {
                "soap": state.soap.model_dump(mode="json"),
                "citations": [citation.model_dump(mode="json") for citation in state.citations],
                "session_id": state.session_id,
            },
        }
    )

    await websocket.send_json(
        {
            "type": "RISK_UPDATE",
            "ts": utc_now().isoformat(),
            "payload": {
                "risks": [risk.model_dump(mode="json") for risk in state.risks],
                "session_id": state.session_id,
            },
        }
    )

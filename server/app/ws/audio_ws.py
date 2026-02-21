from __future__ import annotations
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.session_state import session_registry

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws/audio")
async def audio_ws(websocket: WebSocket) -> None:
    session_id = websocket.query_params.get("session_id")
    if not session_id:
        await websocket.close(code=1008, reason="session_id is required")
        return

    await websocket.accept()

    stt_service = websocket.app.state.stt_service
    batcher = websocket.app.state.batching_manager

    await session_registry.get_or_create(session_id)
    batcher.start_for_session(session_id)

    await session_registry.publish_event(
        session_id,
        "STATUS",
        {
            "state": "recording",
            "message": "Recording started",
        },
    )

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            chunk = message.get("bytes")
            if chunk is not None:
                await stt_service.forward_audio(session_id, chunk)
                continue

            text_message = message.get("text")
            if text_message and text_message.strip().lower() in {"stop", "finalize"}:
                break

    except WebSocketDisconnect:
        logger.info("Audio websocket disconnected for session %s", session_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Audio websocket processing failed for session %s", session_id)
        await session_registry.publish_event(
            session_id,
            "ERROR",
            {
                "code": "AUDIO_WS_ERROR",
                "message": str(exc),
            },
        )
        await session_registry.publish_event(
            session_id,
            "STATUS",
            {
                "state": "error",
                "message": "Audio stream interrupted",
            },
        )
    finally:
        await stt_service.finalize(session_id)
        await stt_service.close(session_id)
        await session_registry.publish_event(
            session_id,
            "STATUS",
            {
                "state": "idle",
                "message": "Recording stopped",
            },
        )

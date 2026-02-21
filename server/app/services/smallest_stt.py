from __future__ import annotations

import asyncio
import json
import logging
from typing import Any
from urllib.parse import urlencode

import websockets
from websockets.exceptions import ConnectionClosed

from app.core.config import Settings
from app.core.session_state import session_registry
from app.core.batching import BatchingManager

logger = logging.getLogger(__name__)


class SmallestSTTService:
    def __init__(self, settings: Settings, batching: BatchingManager) -> None:
        self._settings = settings
        self._batching = batching
        self._receive_tasks: dict[str, asyncio.Task[None]] = {}
        self._session_end_events: dict[str, asyncio.Event] = {}

    async def ensure_connected(self, session_id: str) -> None:
        state = await session_registry.get_or_create(session_id)
        async with state.lock:
            if state.stt_connected and state.smallest_ws is not None:
                return

        if not self._settings.smallest_api_key:
            raise RuntimeError("SMALLEST_API_KEY is not configured")

        url = self._build_ws_url()
        headers = {"Authorization": f"Bearer {self._settings.smallest_api_key}"}

        ws = await self._connect_websocket(url, headers)
        await session_registry.mark_stt_connection(session_id, connected=True, ws_handle=ws)
        self._session_end_events[session_id] = asyncio.Event()
        await session_registry.publish_event(
            session_id,
            "STATUS",
            {"state": "recording", "message": "Connected to STT"},
        )

        task = self._receive_tasks.get(session_id)
        if not task or task.done():
            self._receive_tasks[session_id] = asyncio.create_task(
                self._receive_loop(session_id, ws),
                name=f"smallest-recv-{session_id}",
            )

    async def forward_audio(self, session_id: str, audio_chunk: bytes) -> None:
        if not audio_chunk:
            return

        await self.ensure_connected(session_id)
        state = await session_registry.get_or_create(session_id)
        ws = state.smallest_ws
        if ws is None:
            raise RuntimeError("STT websocket connection is unavailable")
        await ws.send(audio_chunk)

    async def finalize(self, session_id: str) -> None:
        state = await session_registry.get(session_id)
        if not state or not state.smallest_ws:
            return
        end_event = self._session_end_events.setdefault(session_id, asyncio.Event())
        end_event.clear()
        try:
            await state.smallest_ws.send(json.dumps({"type": "end"}))
            try:
                await asyncio.wait_for(end_event.wait(), timeout=4.5)
            except TimeoutError:
                logger.warning("Timed out waiting for final STT 'is_last' for session %s", session_id)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to send finalize signal to Smallest for session %s", session_id)

    async def close(self, session_id: str) -> None:
        state = await session_registry.get(session_id)
        if state and state.smallest_ws:
            try:
                await state.smallest_ws.close()
            except Exception:  # noqa: BLE001
                logger.exception("Failed to close Smallest websocket for session %s", session_id)

        task = self._receive_tasks.pop(session_id, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        self._session_end_events.pop(session_id, None)

        await session_registry.mark_stt_connection(session_id, connected=False, ws_handle=None)

    async def _receive_loop(self, session_id: str, ws: Any) -> None:
        try:
            async for raw_message in ws:
                message = self._decode_message(raw_message)
                if message is None:
                    continue

                transcript = (message.get("transcript") or "").strip()
                is_final = bool(message.get("is_final", False))
                is_last = bool(message.get("is_last", False))
                confidence = _safe_float(message.get("confidence"))

                full_transcript = message.get("full_transcript")
                if isinstance(full_transcript, str) and is_final:
                    transcript = await self._extract_incremental_final(session_id, transcript, full_transcript)

                if not transcript:
                    continue

                if is_final:
                    start_ms, end_ms = _extract_timestamps_ms(message)
                    segment = await session_registry.append_final_segment(
                        session_id=session_id,
                        text=transcript,
                        start_ms=start_ms,
                        end_ms=end_ms,
                    )
                    await session_registry.publish_event(
                        session_id,
                        "STT_FINAL",
                        {
                            "segment": segment.to_json().model_dump(mode="json"),
                            "session_id": session_id,
                        },
                    )
                    await self._batching.notify_new_segment(session_id)
                else:
                    await session_registry.update_partial(session_id, transcript)
                    await session_registry.publish_event(
                        session_id,
                        "STT_PARTIAL",
                        {
                            "text": transcript,
                            "confidence": confidence,
                            "session_id": session_id,
                        },
                    )

                if is_last:
                    end_event = self._session_end_events.get(session_id)
                    if end_event is not None:
                        end_event.set()

        except asyncio.CancelledError:
            raise
        except ConnectionClosed:
            logger.info("Smallest websocket closed for session %s", session_id)
        except Exception:  # noqa: BLE001
            logger.exception("Smallest websocket receive loop failed for session %s", session_id)
            await session_registry.publish_event(
                session_id,
                "ERROR",
                {
                    "code": "SMALLEST_WS_ERROR",
                    "message": "Realtime transcription connection interrupted.",
                },
            )
            await session_registry.publish_event(
                session_id,
                "STATUS",
                {"state": "error", "message": "STT connection error"},
            )
        finally:
            await session_registry.mark_stt_connection(session_id, connected=False, ws_handle=None)

    async def _extract_incremental_final(self, session_id: str, transcript: str, full_transcript: str) -> str:
        state = await session_registry.get_or_create(session_id)
        async with state.lock:
            previous_full = state.last_full_transcript
            state.last_full_transcript = full_transcript

        if previous_full and full_transcript.startswith(previous_full):
            delta = full_transcript[len(previous_full) :].strip()
            if delta:
                return delta
        return transcript or full_transcript.strip()

    def _build_ws_url(self) -> str:
        query = urlencode(
            {
                "language": self._settings.smallest_language,
                "encoding": self._settings.smallest_encoding,
                "sample_rate": self._settings.smallest_sample_rate,
                "full_transcript": "true",
                "word_timestamps": "true",
            }
        )
        return f"wss://waves-api.smallest.ai/api/v1/pulse/get_text?{query}"

    @staticmethod
    async def _connect_websocket(url: str, headers: dict[str, str]) -> Any:
        try:
            return await websockets.connect(url, additional_headers=headers)
        except TypeError:
            return await websockets.connect(url, extra_headers=headers)

    @staticmethod
    def _decode_message(raw_message: Any) -> dict[str, Any] | None:
        if isinstance(raw_message, (bytes, bytearray)):
            try:
                raw_message = raw_message.decode("utf-8")
            except UnicodeDecodeError:
                return None

        if not isinstance(raw_message, str):
            return None

        try:
            parsed = json.loads(raw_message)
        except json.JSONDecodeError:
            return None

        if not isinstance(parsed, dict):
            return None
        return parsed


def _extract_timestamps_ms(message: dict[str, Any]) -> tuple[int | None, int | None]:
    direct_start = message.get("start_ms")
    direct_end = message.get("end_ms")
    if isinstance(direct_start, (int, float)) or isinstance(direct_end, (int, float)):
        return _maybe_ms(direct_start), _maybe_ms(direct_end)

    words = message.get("words")
    if not isinstance(words, list) or not words:
        return None, None

    first = words[0] if isinstance(words[0], dict) else {}
    last = words[-1] if isinstance(words[-1], dict) else {}

    start = first.get("start") or first.get("start_time")
    end = last.get("end") or last.get("end_time")

    return _maybe_ms(start), _maybe_ms(end)


def _maybe_ms(value: Any) -> int | None:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None

    if numeric > 100000:
        return int(numeric)
    return int(numeric * 1000)


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

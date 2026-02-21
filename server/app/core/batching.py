from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from app.core.session_state import session_registry

logger = logging.getLogger(__name__)


class BatchingManager:
    def __init__(
        self,
        process_callback: Callable[[str], Awaitable[None]],
        interval_seconds: int = 12,
        min_new_segments: int = 2,
    ) -> None:
        self._process_callback = process_callback
        self.interval_seconds = interval_seconds
        self.min_new_segments = min_new_segments
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def start_for_session(self, session_id: str) -> None:
        if session_id in self._tasks:
            return
        self._tasks[session_id] = asyncio.create_task(self._run(session_id), name=f"batcher-{session_id}")

    async def stop_for_session(self, session_id: str) -> None:
        task = self._tasks.pop(session_id, None)
        if not task:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    async def stop_all(self) -> None:
        session_ids = list(self._tasks.keys())
        await asyncio.gather(*(self.stop_for_session(session_id) for session_id in session_ids), return_exceptions=True)

    async def notify_new_segment(self, session_id: str) -> None:
        state = await session_registry.get(session_id)
        if not state:
            return
        state.new_final_event.set()

    async def _run(self, session_id: str) -> None:
        try:
            while True:
                state = await session_registry.get(session_id)
                if not state:
                    return

                try:
                    await asyncio.wait_for(state.new_final_event.wait(), timeout=self.interval_seconds)
                except TimeoutError:
                    pass

                state.new_final_event.clear()
                should_process = await session_registry.should_process(
                    session_id,
                    min_new_segments=self.min_new_segments,
                    interval_seconds=self.interval_seconds,
                )
                if not should_process:
                    continue

                try:
                    await self._process_callback(session_id)
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001
                    logger.exception("Batch processing failed for session %s", session_id)
                    await session_registry.publish_event(
                        session_id,
                        "ERROR",
                        {
                            "code": "BATCH_PROCESS_FAILURE",
                            "message": "Failed to process transcript batch. Transcription is still running.",
                        },
                    )
        finally:
            self._tasks.pop(session_id, None)

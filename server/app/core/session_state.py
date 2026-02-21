from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

from app.core.schemas import CitationJSON, RiskJSON, SegmentJSON, SoapNoteJSON, TaskJSON


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Segment:
    id: int
    text: str
    start_ms: int | None
    end_ms: int | None
    is_final: bool
    created_at: datetime

    def to_json(self) -> SegmentJSON:
        return SegmentJSON(
            id=self.id,
            text=self.text,
            start_ms=self.start_ms,
            end_ms=self.end_ms,
        )


@dataclass
class SessionState:
    session_id: str
    created_at: datetime = field(default_factory=utc_now)
    transcript_segments: list[Segment] = field(default_factory=list)
    partial_transcript: str = ""
    soap: SoapNoteJSON = field(default_factory=SoapNoteJSON)
    citations: list[CitationJSON] = field(default_factory=list)
    risks: list[RiskJSON] = field(default_factory=list)
    tasks: list[TaskJSON] = field(default_factory=list)
    last_processed_segment_idx: int = 0
    stt_connected: bool = False
    smallest_ws: Any | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    llm_inflight: bool = False
    subscribers: set[WebSocket] = field(default_factory=set)
    new_final_event: asyncio.Event = field(default_factory=asyncio.Event)
    last_llm_run_at: datetime | None = None
    batcher_task: asyncio.Task[Any] | None = None
    last_full_transcript: str = ""


class SessionRegistry:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionState] = {}
        self._registry_lock = asyncio.Lock()

    async def get_or_create(self, session_id: str) -> SessionState:
        async with self._registry_lock:
            state = self._sessions.get(session_id)
            if state is None:
                state = SessionState(session_id=session_id)
                self._sessions[session_id] = state
            return state

    async def get(self, session_id: str) -> SessionState | None:
        async with self._registry_lock:
            return self._sessions.get(session_id)

    async def remove_if_idle(self, session_id: str) -> None:
        async with self._registry_lock:
            state = self._sessions.get(session_id)
            if not state:
                return
            if state.subscribers or state.stt_connected:
                return
            self._sessions.pop(session_id, None)

    async def subscribe(self, session_id: str, websocket: WebSocket) -> SessionState:
        state = await self.get_or_create(session_id)
        async with state.lock:
            state.subscribers.add(websocket)
        return state

    async def unsubscribe(self, session_id: str, websocket: WebSocket) -> None:
        state = await self.get(session_id)
        if not state:
            return
        async with state.lock:
            state.subscribers.discard(websocket)
        await self.remove_if_idle(session_id)

    async def append_final_segment(
        self,
        session_id: str,
        text: str,
        start_ms: int | None,
        end_ms: int | None,
    ) -> Segment:
        state = await self.get_or_create(session_id)
        async with state.lock:
            segment = Segment(
                id=len(state.transcript_segments) + 1,
                text=text,
                start_ms=start_ms,
                end_ms=end_ms,
                is_final=True,
                created_at=utc_now(),
            )
            state.transcript_segments.append(segment)
            state.partial_transcript = ""
            state.new_final_event.set()
        return segment

    async def update_partial(self, session_id: str, text: str) -> None:
        state = await self.get_or_create(session_id)
        async with state.lock:
            state.partial_transcript = text

    async def mark_stt_connection(
        self,
        session_id: str,
        connected: bool,
        ws_handle: Any | None = None,
    ) -> None:
        state = await self.get_or_create(session_id)
        async with state.lock:
            state.stt_connected = connected
            state.smallest_ws = ws_handle

    async def snapshot_for_llm(self, session_id: str) -> tuple[SoapNoteJSON, list[Segment], list[Segment], int]:
        state = await self.get_or_create(session_id)
        async with state.lock:
            start_idx = state.last_processed_segment_idx
            snapshot_end = len(state.transcript_segments)
            new_segments = list(state.transcript_segments[start_idx:snapshot_end])
            all_segments = list(state.transcript_segments)
            soap = state.soap.model_copy(deep=True)
            return soap, new_segments, all_segments, snapshot_end

    async def commit_llm_updates(
        self,
        session_id: str,
        snapshot_end: int,
        soap: SoapNoteJSON | None,
        citations: list[CitationJSON] | None,
        risks: list[RiskJSON] | None,
        advance_cursor: bool,
    ) -> None:
        state = await self.get_or_create(session_id)
        async with state.lock:
            if soap is not None:
                state.soap = soap
            if citations is not None:
                state.citations = citations
            if risks is not None:
                state.risks = risks
            if advance_cursor:
                state.last_processed_segment_idx = snapshot_end
            state.last_llm_run_at = utc_now()

    async def set_llm_inflight(self, session_id: str, inflight: bool) -> None:
        state = await self.get_or_create(session_id)
        async with state.lock:
            state.llm_inflight = inflight

    async def try_acquire_llm_inflight(self, session_id: str) -> bool:
        state = await self.get_or_create(session_id)
        async with state.lock:
            if state.llm_inflight:
                return False
            state.llm_inflight = True
            return True

    async def is_llm_inflight(self, session_id: str) -> bool:
        state = await self.get_or_create(session_id)
        async with state.lock:
            return state.llm_inflight

    async def should_process(self, session_id: str, min_new_segments: int, interval_seconds: int) -> bool:
        state = await self.get_or_create(session_id)
        async with state.lock:
            if state.llm_inflight:
                return False
            new_count = len(state.transcript_segments) - state.last_processed_segment_idx
            if new_count <= 0:
                return False
            if new_count >= min_new_segments:
                return True
            if state.last_llm_run_at is None:
                return True
            elapsed = (utc_now() - state.last_llm_run_at).total_seconds()
            return elapsed >= interval_seconds

    async def get_event_subscribers(self, session_id: str) -> list[WebSocket]:
        state = await self.get_or_create(session_id)
        async with state.lock:
            return list(state.subscribers)

    async def publish_event(self, session_id: str, event_type: str, payload: dict[str, Any]) -> None:
        state = await self.get_or_create(session_id)
        event = {
            "type": event_type,
            "ts": utc_now().isoformat(),
            "payload": payload,
        }
        subscribers = await self.get_event_subscribers(session_id)
        if not subscribers:
            return

        send_tasks = [subscriber.send_json(event) for subscriber in subscribers]
        results = await asyncio.gather(*send_tasks, return_exceptions=True)

        failed: list[WebSocket] = []
        for subscriber, result in zip(subscribers, results):
            if isinstance(result, Exception):
                failed.append(subscriber)

        if failed:
            async with state.lock:
                for subscriber in failed:
                    state.subscribers.discard(subscriber)


session_registry = SessionRegistry()

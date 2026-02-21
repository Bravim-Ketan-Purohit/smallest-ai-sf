from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from app.core.batching import BatchingManager
from app.core.config import get_settings
from app.core.schemas import DemoSeedRequest
from app.core.session_state import session_registry
from app.services.llm_client import MockLLMClient, build_llm_client
from app.services.risk_sentinel import RiskSentinel
from app.services.smallest_stt import SmallestSTTService
from app.services.soap_updater import SoapUpdater
from app.ws.audio_ws import router as audio_ws_router
from app.ws.events_ws import router as events_ws_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

DEFAULT_DEMO_LINES = [
    "Doctor: Hi, what brings you in today?",
    "Patient: Since yesterday afternoon I have had pressure-like chest pain in the center of my chest and shortness of breath.",
    "Doctor: On a scale from zero to ten, how severe is the pain and what makes it worse?",
    "Patient: It is about seven out of ten and gets worse when I climb stairs.",
    "Doctor: Does the pain radiate to your jaw, arm, or back?",
    "Patient: Yes, it sometimes goes to my left shoulder and jaw.",
    "Doctor: Any sweating, nausea, dizziness, or fainting?",
    "Patient: I felt sweaty and dizzy this morning and had mild nausea but no fainting.",
    "Doctor: Any fever, cough, sore throat, or recent infection symptoms?",
    "Patient: No fever, no cough, and no sore throat.",
    "Doctor: Do you have prior conditions and are you taking your medications?",
    "Patient: I have high blood pressure and type two diabetes, and I missed my blood pressure medication this week.",
    "Doctor: Any smoking history or early heart disease in your family?",
    "Patient: I smoked for ten years and quit last year, and my father had a heart attack at age fifty-two.",
    "Doctor: On exam your blood pressure is 158 over 96, heart rate is 108, oxygen saturation is 94 percent, temperature is 98.7, and lungs are clear.",
    "Doctor: ECG shows nonspecific ST-T changes and initial troponin is pending.",
    "Doctor: My impression is possible acute coronary syndrome; concern for pulmonary embolism is lower but still possible.",
    "Doctor: Differential also includes reflux and musculoskeletal chest pain.",
    "Doctor: Plan is to order serial troponins, repeat ECG, chest X-ray, CBC, BMP, and D-dimer if indicated.",
    "Doctor: We will start aspirin 325 milligrams now and place you on cardiac monitoring.",
    "Doctor: I recommend urgent emergency department evaluation and close follow up if symptoms worsen.",
    "Patient: Should I go right away even if the pain improves?",
    "Doctor: Yes, because chest pain with shortness of breath and your risk factors needs immediate evaluation.",
]

settings = get_settings()
llm_client = build_llm_client(settings)
soap_updater = SoapUpdater(llm_client)
risk_sentinel = RiskSentinel(llm_client)
mock_soap_updater = SoapUpdater(MockLLMClient())
mock_risk_sentinel = RiskSentinel(MockLLMClient())


async def process_session_updates(session_id: str, force_heuristic: bool = False) -> None:
    if not await session_registry.try_acquire_llm_inflight(session_id):
        return

    try:
        snapshot = await session_registry.snapshot_for_llm(session_id)
        previous_soap, new_segments, all_segments, snapshot_end = snapshot
        if not new_segments:
            return

        await session_registry.publish_event(
            session_id,
            "STATUS",
            {"state": "processing", "message": "Updating SOAP and risks"},
        )

        new_segment_json = [segment.to_json() for segment in new_segments]
        all_segment_json = [segment.to_json() for segment in all_segments]

        selected_soap_updater = mock_soap_updater if force_heuristic else soap_updater
        selected_risk_sentinel = mock_risk_sentinel if force_heuristic else risk_sentinel

        soap_result = None
        risk_result = None

        try:
            soap_result = await selected_soap_updater.update(
                previous_soap=previous_soap,
                new_segments=new_segment_json,
                all_segments=all_segment_json,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("SOAP update failed for session %s", session_id)
            await session_registry.publish_event(
                session_id,
                "ERROR",
                {
                    "code": "SOAP_UPDATE_ERROR",
                    "message": f"SOAP update failed: {exc}",
                },
            )

        try:
            risk_result = await selected_risk_sentinel.update(
                new_segments=new_segment_json,
                all_segments=all_segment_json,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Risk update failed for session %s", session_id)
            await session_registry.publish_event(
                session_id,
                "ERROR",
                {
                    "code": "RISK_UPDATE_ERROR",
                    "message": f"Risk update failed: {exc}",
                },
            )

        await session_registry.commit_llm_updates(
            session_id=session_id,
            snapshot_end=snapshot_end,
            soap=soap_result.soap if soap_result else None,
            citations=soap_result.citations if soap_result else None,
            risks=risk_result.risks if risk_result else None,
            advance_cursor=soap_result is not None,
        )

        if soap_result:
            await session_registry.publish_event(
                session_id,
                "SOAP_UPDATE",
                {
                    "soap": soap_result.soap.model_dump(mode="json"),
                    "citations": [citation.model_dump(mode="json") for citation in soap_result.citations],
                    "session_id": session_id,
                },
            )

        if risk_result:
            await session_registry.publish_event(
                session_id,
                "RISK_UPDATE",
                {
                    "risks": [risk.model_dump(mode="json") for risk in risk_result.risks],
                    "session_id": session_id,
                },
            )

    finally:
        await session_registry.set_llm_inflight(session_id, False)
        state = await session_registry.get(session_id)
        status = "recording" if state and state.stt_connected else "idle"
        await session_registry.publish_event(
            session_id,
            "STATUS",
            {"state": status, "message": "Realtime updates active"},
        )


batching_manager = BatchingManager(
    process_callback=process_session_updates,
    interval_seconds=12,
    min_new_segments=2,
)

stt_service = SmallestSTTService(settings, batching=batching_manager)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await batching_manager.stop_all()
    await llm_client.close()


app = FastAPI(title="PulseScribe Server", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.state.settings = settings
app.state.stt_service = stt_service
app.state.batching_manager = batching_manager

app.include_router(events_ws_router)
app.include_router(audio_ws_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/demo/seed")
async def demo_seed(
    request: DemoSeedRequest,
    session_id: str = Query(..., description="Session id from frontend"),
) -> dict[str, int | str]:
    lines = request.lines or DEFAULT_DEMO_LINES

    for idx, line in enumerate(lines, start=1):
        segment = await session_registry.append_final_segment(
            session_id=session_id,
            text=line,
            start_ms=(idx - 1) * 3500,
            end_ms=idx * 3500,
        )
        await session_registry.publish_event(
            session_id,
            "STT_FINAL",
            {
                "segment": segment.to_json().model_dump(mode="json"),
                "session_id": session_id,
            },
        )

    await process_session_updates(session_id, force_heuristic=True)

    return {"status": "seeded", "segments": len(lines)}

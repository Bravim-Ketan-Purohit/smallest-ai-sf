"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { startMicPcmStream, streamDemoAudioFile, type MicStreamHandle } from "@/lib/audio";
import { createSessionId } from "@/lib/session";
import { Citation, EMPTY_SOAP, EventEnvelope, Risk, Segment, SoapNote, StatusPayload } from "@/lib/types";
import type { ApiStep, ApiStepId, ApiStepState, TimelineEvent, TimelineLevel } from "@/lib/useOpsLiveDemo";

const DEFAULT_WS_URL = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? "ws://localhost:8000";
const DEFAULT_HTTP_URL = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "http://localhost:8000";
const EVENTS_SOCKET_WARNING = "Events socket connection error";
export type LiveDemoConversation = "convo" | "convo_short";

const LIVE_DEMO_AUDIO_CANDIDATES: Record<LiveDemoConversation, string[]> = {
  convo: ["/demo/demo-conversation.mp3", "/demo/demo-conversation.wav"],
  convo_short: ["/demo/demo-conversation-short.mp3"],
};

const LIVE_DEMO_LABELS: Record<LiveDemoConversation, string> = {
  convo: "convo",
  convo_short: "convo_short",
};
const MAX_TIMELINE_EVENTS = 120;
const DEMO_SEED_LINES = [
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
];

function nowIso(): string {
  return new Date().toISOString();
}

function buildInitialApiSteps(): Record<ApiStepId, ApiStep> {
  return {
    events_ws: {
      id: "events_ws",
      label: "Events WS (/ws/events)",
      state: "idle",
      detail: "Waiting",
      updatedAt: null,
    },
    audio_ws: {
      id: "audio_ws",
      label: "Audio WS (/ws/audio)",
      state: "idle",
      detail: "Waiting",
      updatedAt: null,
    },
    demo_audio: {
      id: "demo_audio",
      label: "Demo Audio Playback",
      state: "idle",
      detail: "Waiting",
      updatedAt: null,
    },
    smallest_stt: {
      id: "smallest_stt",
      label: "Smallest STT (Pulse WS)",
      state: "idle",
      detail: "Waiting",
      updatedAt: null,
    },
    soap: {
      id: "soap",
      label: "SOAP Update (LLM)",
      state: "idle",
      detail: "Waiting",
      updatedAt: null,
    },
    risk: {
      id: "risk",
      label: "Risk Sentinel (LLM)",
      state: "idle",
      detail: "Waiting",
      updatedAt: null,
    },
  };
}

export function usePulseScribe() {
  const [sessionId, setSessionId] = useState("");

  const [status, setStatus] = useState<StatusPayload["state"]>("idle");
  const [statusMessage, setStatusMessage] = useState("Ready");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [soap, setSoap] = useState<SoapNote>(EMPTY_SOAP);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [eventsConnected, setEventsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [liveDemoConversation, setLiveDemoConversation] = useState<LiveDemoConversation>("convo");
  const [playLiveAudioOut, setPlayLiveAudioOut] = useState(true);
  const [apiSteps, setApiSteps] = useState<Record<ApiStepId, ApiStep>>(buildInitialApiSteps());
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [highlightedSegmentIds, setHighlightedSegmentIds] = useState<number[]>([]);
  const [soapUpdatedAt, setSoapUpdatedAt] = useState<string | null>(null);
  const [riskUpdatedAt, setRiskUpdatedAt] = useState<string | null>(null);
  const [eventLatencyMs, setEventLatencyMs] = useState<number | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const eventsSocketRef = useRef<WebSocket | null>(null);
  const audioSocketRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MicStreamHandle | null>(null);
  const liveAudioRef = useRef<HTMLAudioElement | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const segmentsRef = useRef<Segment[]>([]);

  useEffect(() => {
    setSessionId(createSessionId());
  }, []);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  const setApiStep = useCallback((id: ApiStepId, state: ApiStepState, detail: string) => {
    setApiSteps((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        state,
        detail,
        updatedAt: nowIso(),
      },
    }));
  }, []);

  const pushTimeline = useCallback((level: TimelineLevel, title: string, detail: string) => {
    setTimeline((prev) => {
      const item: TimelineEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: nowIso(),
        level,
        title,
        detail,
      };
      return [item, ...prev].slice(0, MAX_TIMELINE_EVENTS);
    });
  }, []);

  const addWarning = useCallback((warning: string) => {
    setWarnings((prev) => {
      if (prev.includes(warning)) {
        return prev;
      }
      const next = [...prev, warning];
      return next.slice(-4);
    });
  }, []);

  const removeWarning = useCallback((warning: string) => {
    setWarnings((prev) => prev.filter((item) => item !== warning));
  }, []);

  const closeAudioSocket = useCallback(() => {
    const socket = audioSocketRef.current;
    if (!socket) {
      return;
    }
    if (socket.readyState === WebSocket.OPEN) {
      socket.send("finalize");
    }
    socket.close();
    audioSocketRef.current = null;
  }, []);

  const stopLiveDemoAudio = useCallback(() => {
    const audio = liveAudioRef.current;
    if (!audio) {
      return;
    }
    audio.pause();
    audio.currentTime = 0;
    liveAudioRef.current = null;
    setApiStep("demo_audio", "idle", "Stopped");
    pushTimeline("info", "Playback stopped", "Live demo audio output stopped.");
  }, [pushTimeline, setApiStep]);

  const stopRecording = useCallback(async () => {
    setIsRecording(false);
    if (micStreamRef.current) {
      await micStreamRef.current.stop();
      micStreamRef.current = null;
    }
    closeAudioSocket();
  }, [closeAudioSocket]);

  const connectEventsSocket = useCallback(() => {
    if (!sessionId) {
      return;
    }

    const ws = new WebSocket(`${DEFAULT_WS_URL}/ws/events?session_id=${sessionId}`);
    eventsSocketRef.current = ws;
    setApiStep("events_ws", "running", "Connecting");

    ws.onopen = () => {
      setEventsConnected(true);
      removeWarning(EVENTS_SOCKET_WARNING);
      setApiStep("events_ws", "success", "Connected");
      pushTimeline("success", "Events websocket connected", `session_id=${sessionId}`);
    };

    ws.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as EventEnvelope;
        const eventTimestamp = Date.parse(event.ts);
        if (!Number.isNaN(eventTimestamp)) {
          setEventLatencyMs(Math.max(0, Date.now() - eventTimestamp));
        }

        switch (event.type) {
          case "STATUS": {
            const payload = event.payload as StatusPayload;
            setStatus(payload.state);
            setStatusMessage(payload.message);
            if (payload.message.toLowerCase().includes("connected to stt")) {
              setApiStep("smallest_stt", "success", payload.message);
            } else if (payload.state === "processing") {
              setApiStep("soap", "running", "Processing transcript batch");
              setApiStep("risk", "running", "Processing transcript batch");
            } else if (payload.state === "error") {
              setApiStep("smallest_stt", "error", payload.message);
            }
            pushTimeline("info", `STATUS: ${payload.state}`, payload.message);
            return;
          }
          case "STT_PARTIAL": {
            const payload = event.payload as { text: string };
            setPartialTranscript(payload.text);
            setApiStep("smallest_stt", "running", "Streaming partial transcript");
            return;
          }
          case "STT_FINAL": {
            const payload = event.payload as { segment: Segment };
            setPartialTranscript("");
            setSegments((prev) => {
              if (prev.some((segment) => segment.id === payload.segment.id)) {
                return prev;
              }
              return [...prev, payload.segment];
            });
            setApiStep("smallest_stt", "success", `Received final segment #${payload.segment.id}`);
            pushTimeline("success", "STT final", payload.segment.text);
            return;
          }
          case "SOAP_UPDATE": {
            const payload = event.payload as { soap: SoapNote; citations: Citation[] };
            setSoap(payload.soap);
            setCitations(payload.citations ?? []);
            setSoapUpdatedAt(event.ts);
            setApiStep("soap", "success", "SOAP updated");
            pushTimeline("success", "SOAP update", "Structured SOAP generated.");
            return;
          }
          case "RISK_UPDATE": {
            const payload = event.payload as { risks: Risk[] };
            setRisks(payload.risks ?? []);
            setRiskUpdatedAt(event.ts);
            setApiStep("risk", "success", `Risk update (${payload.risks?.length ?? 0} items)`);
            pushTimeline("success", "Risk update", `Received ${payload.risks?.length ?? 0} risks.`);
            return;
          }
          case "ERROR": {
            const payload = event.payload as { code?: string; message?: string };
            const messageText = payload.message || "Unknown backend error";
            const code = (payload.code ?? "").toUpperCase();
            addWarning(messageText);
            if (code.includes("SOAP")) {
              setApiStep("soap", "error", messageText);
            } else if (code.includes("RISK")) {
              setApiStep("risk", "error", messageText);
            } else if (code.includes("SMALLEST")) {
              setApiStep("smallest_stt", "error", messageText);
            } else if (code.includes("AUDIO")) {
              setApiStep("audio_ws", "error", messageText);
            }
            pushTimeline("error", "Backend error", messageText);
            return;
          }
          default:
            return;
        }
      } catch {
        addWarning("Failed to parse realtime event message");
        pushTimeline("warn", "Event parse warning", "Failed to parse realtime event message.");
      }
    };

    ws.onclose = () => {
      setEventsConnected(false);
      setApiStep("events_ws", "idle", "Disconnected");
      pushTimeline("warn", "Events websocket closed", "Reconnecting in 1.2s...");
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = window.setTimeout(() => {
        connectEventsSocket();
      }, 1200);
    };

    ws.onerror = () => {
      setEventsConnected(false);
      addWarning(EVENTS_SOCKET_WARNING);
      setApiStep("events_ws", "error", "Socket error");
      pushTimeline("error", "Events websocket error", EVENTS_SOCKET_WARNING);
    };
  }, [addWarning, pushTimeline, removeWarning, sessionId, setApiStep]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    connectEventsSocket();
    return () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      setEventsConnected(false);
      eventsSocketRef.current?.close();
      void stopRecording();
      stopLiveDemoAudio();
    };
  }, [connectEventsSocket, stopLiveDemoAudio, stopRecording]);

  const openAudioSocket = useCallback(async (): Promise<WebSocket> => {
    if (!sessionId) {
      throw new Error("Session is still initializing");
    }

    if (audioSocketRef.current && audioSocketRef.current.readyState === WebSocket.OPEN) {
      return audioSocketRef.current;
    }

    setApiStep("audio_ws", "running", "Connecting");
    const ws = new WebSocket(`${DEFAULT_WS_URL}/ws/audio?session_id=${sessionId}`);
    ws.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        setApiStep("audio_ws", "success", "Connected");
        pushTimeline("success", "Audio websocket connected", `session_id=${sessionId}`);
        resolve();
      };
      ws.onerror = () => {
        setApiStep("audio_ws", "error", "Connection failed");
        reject(new Error("Audio websocket connection failed"));
      };
    });

    audioSocketRef.current = ws;
    return ws;
  }, [pushTimeline, sessionId, setApiStep]);

  const waitForSegmentIncrease = useCallback(async (initialCount: number, timeoutMs: number): Promise<boolean> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (segmentsRef.current.length > initialCount) {
        return true;
      }
      await delay(180);
    }
    return segmentsRef.current.length > initialCount;
  }, []);

  const startRecording = useCallback(async () => {
    if (!sessionId) {
      addWarning("Session is still initializing. Please try again.");
      return;
    }

    if (isRecording) {
      return;
    }

    try {
      const ws = await openAudioSocket();
      const mic = await startMicPcmStream((chunk) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        }
      });
      micStreamRef.current = mic;
      setIsRecording(true);
      setStatus("recording");
      setStatusMessage("Listening");
    } catch (error) {
      addWarning(error instanceof Error ? error.message : "Failed to start recording");
      setStatus("error");
      setStatusMessage("Microphone unavailable");
      await stopRecording();
    }
  }, [addWarning, isRecording, openAudioSocket, sessionId, stopRecording]);

  const playLiveDemoConversation = useCallback(async () => {
    if (!sessionId) {
      addWarning("Session is still initializing. Please try again.");
      return;
    }

    try {
      await stopRecording();
      stopLiveDemoAudio();
      const ws = await openAudioSocket();
      setStatus("recording");
      setStatusMessage("Playing live demo audio");

      const segmentCountBefore = segmentsRef.current.length;
      setApiStep("smallest_stt", "running", "Waiting for transcript");
      setApiStep("soap", "idle", "Waiting for transcript batch");
      setApiStep("risk", "idle", "Waiting for transcript batch");
      pushTimeline("info", "Live demo started", `script=${LIVE_DEMO_LABELS[liveDemoConversation]}`);

      const preferredAudioPath = LIVE_DEMO_AUDIO_CANDIDATES[liveDemoConversation][0];
      if (playLiveAudioOut) {
        try {
          const playback = new Audio(preferredAudioPath);
          playback.volume = 1;
          playback.preload = "auto";
          await playback.play();
          liveAudioRef.current = playback;
          setApiStep("demo_audio", "running", `Playing out loud (${preferredAudioPath})`);
          pushTimeline("success", "Loud playback started", preferredAudioPath);
        } catch {
          setApiStep("demo_audio", "error", "Browser blocked playback");
          pushTimeline("warn", "Playback blocked", "Browser blocked audio autoplay; click a button first.");
        }
      } else {
        setApiStep("demo_audio", "idle", "Muted by toggle");
      }

      try {
        const audioPath = await streamLiveDemoAudio(ws, liveDemoConversation);
        setStatusMessage(`Playing live demo audio (${LIVE_DEMO_LABELS[liveDemoConversation]}: ${audioPath})`);
        if (!playLiveAudioOut) {
          setApiStep("demo_audio", "success", `Streamed silently (${audioPath})`);
        }
        await delay(3500);
      } finally {
        closeAudioSocket();
        setApiStep("audio_ws", "idle", "Closed");
      }

      if (liveAudioRef.current) {
        await waitForAudioEnd(liveAudioRef.current, 3000);
      }

      const hasSegment = await waitForSegmentIncrease(segmentCountBefore, 5000);
      if (!hasSegment) {
        addWarning("Live demo audio finished but produced no transcript. Check Smallest API key/network.");
        setStatus("error");
        setStatusMessage("Live demo produced no transcript");
        setApiStep("smallest_stt", "error", "No transcript segments received");
        pushTimeline("error", "No transcript received", "Live demo audio completed without STT segments.");
        return;
      }

      setStatus("processing");
      setStatusMessage("Processing live demo transcript");
      setApiStep("smallest_stt", "success", `Segments received: ${segmentsRef.current.length - segmentCountBefore}`);
      if (playLiveAudioOut) {
        setApiStep("demo_audio", "success", "Playback and stream complete");
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Live demo mode failed";
      addWarning(messageText);
      setStatus("error");
      setStatusMessage("Live demo unavailable");
      setApiStep("audio_ws", "error", messageText);
      setApiStep("demo_audio", "error", messageText);
      pushTimeline("error", "Live demo failed", messageText);
    }
  }, [
    addWarning,
    closeAudioSocket,
    liveDemoConversation,
    openAudioSocket,
    playLiveAudioOut,
    pushTimeline,
    sessionId,
    setApiStep,
    stopLiveDemoAudio,
    stopRecording,
    waitForSegmentIncrease,
  ]);

  const playSeededDemoConversation = useCallback(async () => {
    if (!sessionId) {
      addWarning("Session is still initializing. Please try again.");
      return;
    }

    try {
      await stopRecording();
      setStatus("processing");
      setStatusMessage("Loading seeded demo transcript");
      setApiStep("audio_ws", "idle", "Not used in seeded mode");
      setApiStep("demo_audio", "idle", "Not used in seeded mode");
      pushTimeline("info", "Seeded demo started", "Injecting scripted transcript (no live API audio stream).");
      await seedDemoTranscript(sessionId);
      setApiStep("smallest_stt", "idle", "Seeded transcript injected");
      setApiStep("soap", "running", "Processing seeded transcript");
      setApiStep("risk", "running", "Processing seeded transcript");
    } catch (error) {
      addWarning(error instanceof Error ? error.message : "Seeded demo mode failed");
      setStatus("error");
      setStatusMessage("Seeded demo unavailable");
      setApiStep("soap", "error", "Seeded flow failed");
      setApiStep("risk", "error", "Seeded flow failed");
    }
  }, [addWarning, pushTimeline, sessionId, setApiStep, stopRecording]);

  const clearSessionView = useCallback(() => {
    setSegments([]);
    setPartialTranscript("");
    setSoap(EMPTY_SOAP);
    setCitations([]);
    setRisks([]);
    setWarnings([]);
    setHighlightedSegmentIds([]);
    setSoapUpdatedAt(null);
    setRiskUpdatedAt(null);
  }, []);

  const clearOpsTimeline = useCallback(() => {
    setTimeline([]);
  }, []);

  return {
    sessionId,
    status,
    statusMessage,
    partialTranscript,
    segments,
    soap,
    citations,
    risks,
    warnings,
    eventsConnected,
    isRecording,
    liveDemoConversation,
    setLiveDemoConversation,
    playLiveAudioOut,
    setPlayLiveAudioOut,
    stopLiveDemoAudio,
    apiSteps,
    timeline,
    clearOpsTimeline,
    highlightedSegmentIds,
    setHighlightedSegmentIds,
    soapUpdatedAt,
    riskUpdatedAt,
    eventLatencyMs,
    autoScroll,
    setAutoScroll,
    startRecording,
    stopRecording,
    playLiveDemoConversation,
    playSeededDemoConversation,
    clearSessionView,
  };
}

async function seedDemoTranscript(sessionId: string): Promise<void> {
  const response = await fetch(`${DEFAULT_HTTP_URL}/demo/seed?session_id=${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines: DEMO_SEED_LINES }),
  });

  if (!response.ok) {
    throw new Error("Demo mode fallback failed");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAudioEnd(audio: HTMLAudioElement, timeoutMs: number): Promise<void> {
  await Promise.race([
    new Promise<void>((resolve) => {
      if (audio.ended) {
        resolve();
        return;
      }
      const onEnd = () => {
        audio.removeEventListener("ended", onEnd);
        resolve();
      };
      audio.addEventListener("ended", onEnd);
    }),
    delay(timeoutMs),
  ]);
}

async function streamLiveDemoAudio(ws: WebSocket, conversation: LiveDemoConversation): Promise<string> {
  let lastError: unknown = null;
  const candidates = LIVE_DEMO_AUDIO_CANDIDATES[conversation];
  for (const path of candidates) {
    try {
      await streamDemoAudioFile(ws, path);
      return path;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("No demo audio file found in client/public/demo.");
}

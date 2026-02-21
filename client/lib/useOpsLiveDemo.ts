"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { streamDemoAudioFile } from "@/lib/audio";
import { createSessionId } from "@/lib/session";
import { EMPTY_SOAP, EventEnvelope, Risk, Segment, SoapNote, StatusPayload } from "@/lib/types";

const DEFAULT_WS_URL = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? "ws://localhost:8000";

export type OpsDemoScript = "convo" | "convo_short";
export type ApiStepId = "events_ws" | "audio_ws" | "demo_audio" | "smallest_stt" | "soap" | "risk";
export type ApiStepState = "idle" | "running" | "success" | "error";
export type TimelineLevel = "info" | "success" | "warn" | "error";

export interface ApiStep {
  id: ApiStepId;
  label: string;
  state: ApiStepState;
  detail: string;
  updatedAt: string | null;
}

export interface TimelineEvent {
  id: string;
  ts: string;
  level: TimelineLevel;
  title: string;
  detail: string;
}

const SCRIPT_PATHS: Record<OpsDemoScript, string> = {
  convo: "/demo/demo-conversation.mp3",
  convo_short: "/demo/demo-conversation-short.mp3",
};

const MAX_TIMELINE_EVENTS = 120;

function buildInitialSteps(): Record<ApiStepId, ApiStep> {
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

function nowIso(): string {
  return new Date().toISOString();
}

export function useOpsLiveDemo() {
  const [sessionId, setSessionId] = useState("");
  const [selectedScript, setSelectedScript] = useState<OpsDemoScript>("convo");
  const [isRunning, setIsRunning] = useState(false);
  const [eventsConnected, setEventsConnected] = useState(false);
  const [steps, setSteps] = useState<Record<ApiStepId, ApiStep>>(buildInitialSteps());
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [soap, setSoap] = useState<SoapNote>(EMPTY_SOAP);
  const [risks, setRisks] = useState<Risk[]>([]);

  const eventsSocketRef = useRef<WebSocket | null>(null);
  const audioSocketRef = useRef<WebSocket | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const segmentsRef = useRef<Segment[]>([]);

  useEffect(() => {
    setSessionId(createSessionId());
  }, []);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  const setStep = useCallback((id: ApiStepId, state: ApiStepState, detail: string) => {
    setSteps((prev) => ({
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
      const event: TimelineEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: nowIso(),
        level,
        title,
        detail,
      };
      return [event, ...prev].slice(0, MAX_TIMELINE_EVENTS);
    });
  }, []);

  const closeAudioSocket = useCallback(() => {
    const ws = audioSocketRef.current;
    if (!ws) {
      return;
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send("finalize");
    }
    ws.close();
    audioSocketRef.current = null;
  }, []);

  const stopPlayback = useCallback(() => {
    const audio = audioPlayerRef.current;
    if (!audio) {
      return;
    }
    audio.pause();
    audio.currentTime = 0;
    audioPlayerRef.current = null;
    setStep("demo_audio", "idle", "Stopped");
    pushTimeline("info", "Playback stopped", "Audio output stopped by user.");
  }, [pushTimeline, setStep]);

  const handleStatusEvent = useCallback(
    (payload: StatusPayload) => {
      if (payload.message.toLowerCase().includes("connected to stt")) {
        setStep("smallest_stt", "success", payload.message);
      } else if (payload.message.toLowerCase().includes("updating soap and risks")) {
        setStep("soap", "running", "Processing transcript batch");
        setStep("risk", "running", "Processing transcript batch");
      } else if (payload.state === "error") {
        setStep("smallest_stt", "error", payload.message);
      }
      pushTimeline("info", `STATUS: ${payload.state}`, payload.message);
    },
    [pushTimeline, setStep]
  );

  const connectEventsSocket = useCallback(() => {
    if (!sessionId) {
      return;
    }

    const ws = new WebSocket(`${DEFAULT_WS_URL}/ws/events?session_id=${sessionId}`);
    eventsSocketRef.current = ws;
    setStep("events_ws", "running", "Connecting");

    ws.onopen = () => {
      setEventsConnected(true);
      setStep("events_ws", "success", "Connected");
      pushTimeline("success", "Events websocket connected", `session_id=${sessionId}`);
    };

    ws.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as EventEnvelope;

        switch (event.type) {
          case "STATUS": {
            handleStatusEvent(event.payload as StatusPayload);
            break;
          }
          case "STT_PARTIAL": {
            const payload = event.payload as { text: string };
            setPartialTranscript(payload.text);
            setStep("smallest_stt", "running", "Streaming partial transcript");
            break;
          }
          case "STT_FINAL": {
            const payload = event.payload as { segment: Segment };
            setPartialTranscript("");
            setSegments((prev) => (prev.some((item) => item.id === payload.segment.id) ? prev : [...prev, payload.segment]));
            setStep("smallest_stt", "success", `Received final segment #${payload.segment.id}`);
            pushTimeline("success", "STT final", payload.segment.text);
            break;
          }
          case "SOAP_UPDATE": {
            const payload = event.payload as { soap: SoapNote };
            setSoap(payload.soap);
            setStep("soap", "success", "SOAP updated");
            pushTimeline("success", "SOAP update", "Structured SOAP generated.");
            break;
          }
          case "RISK_UPDATE": {
            const payload = event.payload as { risks: Risk[] };
            setRisks(payload.risks ?? []);
            setStep("risk", "success", `Risk update (${payload.risks?.length ?? 0} items)`);
            pushTimeline("success", "Risk update", `Received ${payload.risks?.length ?? 0} risk entries.`);
            break;
          }
          case "ERROR": {
            const payload = event.payload as { code?: string; message?: string };
            const code = (payload.code ?? "").toUpperCase();
            const messageText = payload.message ?? "Unknown backend error";
            if (code.includes("SOAP")) {
              setStep("soap", "error", messageText);
            } else if (code.includes("RISK")) {
              setStep("risk", "error", messageText);
            } else if (code.includes("SMALLEST")) {
              setStep("smallest_stt", "error", messageText);
            } else if (code.includes("AUDIO")) {
              setStep("audio_ws", "error", messageText);
            }
            pushTimeline("error", "Backend error", messageText);
            break;
          }
          default:
            break;
        }
      } catch {
        pushTimeline("warn", "Event parse warning", "Failed to parse events payload.");
      }
    };

    ws.onerror = () => {
      setEventsConnected(false);
      setStep("events_ws", "error", "Socket error");
      pushTimeline("error", "Events websocket error", "Failed to receive realtime events.");
    };

    ws.onclose = () => {
      setEventsConnected(false);
      setStep("events_ws", "idle", "Disconnected");
      pushTimeline("warn", "Events websocket closed", "Reconnecting in 1.2s...");
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = window.setTimeout(() => {
        connectEventsSocket();
      }, 1200);
    };
  }, [handleStatusEvent, pushTimeline, sessionId, setStep]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    connectEventsSocket();
    return () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      eventsSocketRef.current?.close();
      closeAudioSocket();
      stopPlayback();
    };
  }, [closeAudioSocket, connectEventsSocket, sessionId, stopPlayback]);

  const runLiveDemoWithSound = useCallback(async () => {
    if (!sessionId || isRunning) {
      return;
    }

    const scriptPath = SCRIPT_PATHS[selectedScript];
    const segmentCountBefore = segmentsRef.current.length;

    setIsRunning(true);
    setStep("audio_ws", "running", "Connecting");
    setStep("demo_audio", "running", "Preparing loud playback");
    setStep("smallest_stt", "running", "Waiting for transcript");
    setStep("soap", "idle", "Waiting for batch trigger");
    setStep("risk", "idle", "Waiting for batch trigger");
    pushTimeline("info", "Live demo start", `script=${selectedScript}, file=${scriptPath}`);

    try {
      const ws = new WebSocket(`${DEFAULT_WS_URL}/ws/audio?session_id=${sessionId}`);
      audioSocketRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("Audio websocket connection failed"));
      });

      setStep("audio_ws", "success", "Connected");
      pushTimeline("success", "Audio websocket connected", `session_id=${sessionId}`);

      const playback = new Audio(scriptPath);
      playback.volume = 1;
      playback.preload = "auto";
      audioPlayerRef.current = playback;

      let playbackStarted = false;
      try {
        await playback.play();
        playbackStarted = true;
        setStep("demo_audio", "running", "Playing out loud");
        pushTimeline("success", "Loud playback started", scriptPath);
      } catch {
        setStep("demo_audio", "error", "Browser blocked playback");
        pushTimeline("warn", "Playback blocked", "User interaction may be required.");
      }

      await streamDemoAudioFile(ws, scriptPath);
      if (playbackStarted) {
        await waitForAudioEnd(playback, 3000);
      }

      setStep("demo_audio", "success", "Playback and stream complete");
      pushTimeline("success", "Audio streamed", scriptPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live demo failed";
      setStep("audio_ws", "error", message);
      setStep("demo_audio", "error", message);
      pushTimeline("error", "Live demo failure", message);
    } finally {
      closeAudioSocket();
      await delay(4500);
      if (segmentsRef.current.length <= segmentCountBefore) {
        setStep("smallest_stt", "error", "No transcript segments received");
        pushTimeline("error", "No transcript received", "Check Smallest API key/network.");
      } else {
        setStep("smallest_stt", "success", `Segments received: ${segmentsRef.current.length - segmentCountBefore}`);
      }
      setIsRunning(false);
    }
  }, [closeAudioSocket, isRunning, pushTimeline, selectedScript, sessionId, setStep]);

  const clearTimeline = useCallback(() => {
    setTimeline([]);
  }, []);

  return {
    sessionId,
    selectedScript,
    setSelectedScript,
    isRunning,
    eventsConnected,
    steps,
    timeline,
    partialTranscript,
    segments,
    soap,
    risks,
    runLiveDemoWithSound,
    stopPlayback,
    clearTimeline,
  };
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

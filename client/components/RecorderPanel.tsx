"use client";

import type { LiveDemoConversation } from "@/lib/usePulseScribe";

interface RecorderPanelProps {
  isRecording: boolean;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onLiveDemo: () => Promise<void>;
  liveDemoConversation: LiveDemoConversation;
  onLiveDemoConversationChange: (value: LiveDemoConversation) => void;
  playLiveAudioOut: boolean;
  onTogglePlayLiveAudioOut: () => void;
  onStopLiveAudio: () => void;
  onClearOpsTimeline: () => void;
  onSeededDemo: () => Promise<void>;
  onClear: () => void;
  sessionId: string;
}

export function RecorderPanel({
  isRecording,
  onStart,
  onStop,
  onLiveDemo,
  liveDemoConversation,
  onLiveDemoConversationChange,
  playLiveAudioOut,
  onTogglePlayLiveAudioOut,
  onStopLiveAudio,
  onClearOpsTimeline,
  onSeededDemo,
  onClear,
  sessionId,
}: RecorderPanelProps) {
  return (
    <section className="card animate-riseIn flex flex-col gap-3 p-3.5 sm:p-4">
      <div>
        <h2 className="font-display text-base font-semibold tracking-tight sm:text-lg">Recorder</h2>
        <p className="text-xs text-muted/90">Session: {sessionId ? `${sessionId.slice(0, 8)}...` : "initializing..."}</p>
      </div>

      <div className="space-y-2">
        <label className="flex items-center justify-between gap-2 rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-medium text-muted">
          <span className="uppercase tracking-wide text-muted/80">Script</span>
          <select
            value={liveDemoConversation}
            onChange={(event) => onLiveDemoConversationChange(event.target.value as LiveDemoConversation)}
            className="rounded-md border border-white/20 bg-white/5 px-2 py-1 text-xs font-semibold text-white outline-none transition focus:border-white/40"
          >
            <option value="convo">convo</option>
            <option value="convo_short">convo_short</option>
          </select>
        </label>

        <button
          type="button"
          onClick={onTogglePlayLiveAudioOut}
          className={`w-full rounded-xl border px-3 py-2 text-xs font-semibold transition ${
            playLiveAudioOut
              ? "border-white/[0.35] bg-white/[0.14] text-white hover:bg-white/[0.18]"
              : "border-white/20 bg-white/5 text-white/90 hover:bg-white/10"
          }`}
        >
          {playLiveAudioOut ? "Audio out loud: ON" : "Audio out loud: OFF"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            void (isRecording ? onStop() : onStart());
          }}
          className={`rounded-xl border px-3 py-2 text-xs font-semibold transition sm:col-span-2 ${
            isRecording
              ? "border-white/40 bg-white/[0.16] text-white hover:bg-white/[0.22]"
              : "border-white/[0.28] bg-white/[0.09] text-white/90 hover:bg-white/[0.16]"
          }`}
        >
          {isRecording ? "Stop recording" : "Start recording"}
        </button>

        <button
          type="button"
          onClick={() => {
            void onLiveDemo();
          }}
          className="rounded-xl border border-white/30 bg-white/[0.12] px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/[0.18]"
        >
          Play live demo (real APIs)
        </button>

        <button
          type="button"
          onClick={() => {
            void onSeededDemo();
          }}
          className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 transition hover:bg-white/10"
        >
          Play seeded demo (no API cost)
        </button>

        <button
          type="button"
          onClick={onClear}
          className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold text-muted transition hover:border-white/40 hover:bg-white/5 hover:text-white"
        >
          Clear panels
        </button>

        <button
          type="button"
          onClick={onStopLiveAudio}
          className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 transition hover:bg-white/10"
        >
          Stop live audio
        </button>

        <button
          type="button"
          onClick={onClearOpsTimeline}
          className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold text-muted transition hover:border-white/40 hover:bg-white/5 hover:text-white sm:col-span-2"
        >
          Clear ops timeline
        </button>
      </div>

      <p className="text-[11px] text-muted/90">
        `convo` uses `/demo/demo-conversation.mp3`; `convo_short` uses `/demo/demo-conversation-short.mp3`.
        Live mode calls Smallest + LLM APIs. Seeded mode runs without API cost.
      </p>
    </section>
  );
}

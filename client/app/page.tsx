"use client";

import { useEffect, useState } from "react";

import { HeaderBar } from "@/components/HeaderBar";
import { ApiStatusLoop } from "@/components/ApiStatusLoop";
import { OpsTimeline } from "@/components/OpsTimeline";
import { RecorderPanel } from "@/components/RecorderPanel";
import { RiskPanel } from "@/components/RiskPanel";
import { SoapPanel } from "@/components/SoapPanel";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { WarningsPanel } from "@/components/WarningsPanel";
import { usePulseScribe } from "@/lib/usePulseScribe";

export default function HomePage() {
  const {
    sessionId,
    status,
    statusMessage,
    eventsConnected,
    partialTranscript,
    segments,
    soap,
    citations,
    risks,
    warnings,
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
  } = usePulseScribe();

  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem("pulse-theme");
    const initialDark = stored ? stored === "dark" : true;
    setIsDark(initialDark);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    window.localStorage.setItem("pulse-theme", isDark ? "dark" : "light");
  }, [isDark]);

  return (
    <main className="relative mx-auto max-w-[1800px] px-3 py-3 sm:px-5 sm:py-4">
      <div className="pointer-events-none absolute inset-x-0 -top-24 h-56 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.14),transparent_68%)] blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-16 h-40 w-[42vw] bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.08),transparent_72%)] blur-3xl" />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[336px_minmax(0,1fr)]">
        <aside className="space-y-3 xl:sticky xl:top-3 xl:h-[calc(100vh-1.5rem)] xl:overflow-y-auto xl:pr-1">
          <section className="card p-3.5">
            <p className="font-display text-base font-semibold tracking-tight">Options Center</p>
            <p className="text-xs text-muted">Controls, demo mode, live audio, and warnings.</p>
          </section>

          <RecorderPanel
            sessionId={sessionId}
            isRecording={isRecording}
            onStart={startRecording}
            onStop={stopRecording}
            onLiveDemo={playLiveDemoConversation}
            liveDemoConversation={liveDemoConversation}
            onLiveDemoConversationChange={setLiveDemoConversation}
            playLiveAudioOut={playLiveAudioOut}
            onTogglePlayLiveAudioOut={() => setPlayLiveAudioOut((prev) => !prev)}
            onStopLiveAudio={stopLiveDemoAudio}
            onClearOpsTimeline={clearOpsTimeline}
            onSeededDemo={playSeededDemoConversation}
            onClear={clearSessionView}
          />

          <WarningsPanel warnings={warnings} />
        </aside>

        <section className="space-y-3">
          <HeaderBar
            status={status}
            statusMessage={statusMessage}
            eventsConnected={eventsConnected}
            eventLatencyMs={eventLatencyMs}
            isDark={isDark}
            onToggleTheme={() => setIsDark((prev) => !prev)}
          />

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <ApiStatusLoop steps={Object.values(apiSteps)} />
            </div>
            <OpsTimeline events={timeline} />
          </section>

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <TranscriptPanel
              partialTranscript={partialTranscript}
              segments={segments}
              highlightedSegmentIds={highlightedSegmentIds}
              autoScroll={autoScroll}
              setAutoScroll={setAutoScroll}
            />

            <SoapPanel
              soap={soap}
              citations={citations}
              lastUpdated={soapUpdatedAt}
              onHighlightEvidence={setHighlightedSegmentIds}
            />

            <RiskPanel
              risks={risks}
              lastUpdated={riskUpdatedAt}
              onHighlightEvidence={setHighlightedSegmentIds}
            />
          </section>

          {highlightedSegmentIds.length > 0 && (
            <div className="card flex items-center justify-between gap-3 border-white/20 bg-white/5 p-2.5">
              <p className="text-sm text-muted">Highlighting transcript segments: {highlightedSegmentIds.join(", ")}</p>
              <button
                type="button"
                onClick={() => setHighlightedSegmentIds([])}
                className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1 text-xs font-medium text-muted transition hover:border-white/40 hover:bg-white/10 hover:text-white"
              >
                Clear highlight
              </button>
            </div>
          )}

          <footer className="pb-1 text-center text-xs text-muted">For demo only. Not medical advice.</footer>
        </section>
      </div>
    </main>
  );
}

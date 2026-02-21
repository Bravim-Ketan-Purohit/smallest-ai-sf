"use client";

import { ApiStatusLoop } from "@/components/ApiStatusLoop";
import { OpsTimeline } from "@/components/OpsTimeline";
import { useOpsLiveDemo } from "@/lib/useOpsLiveDemo";

export default function OpsLivePage() {
  const {
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
  } = useOpsLiveDemo();

  return (
    <main className="relative mx-auto max-w-[1700px] px-3 py-4 sm:px-6 sm:py-6">
      <div className="pointer-events-none absolute inset-x-0 -top-24 h-52 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.18),transparent_70%)] blur-3xl" />
      <div className="space-y-4">
        <section className="card animate-riseIn p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">PulseScribe Ops Live Demo</h1>
              <p className="text-sm text-muted">Standalone live loop view: API statuses + timeline + loud playback.</p>
              <p className="mt-1 text-xs text-muted">Session: {sessionId ? `${sessionId.slice(0, 8)}...` : "initializing..."}</p>
            </div>
            <span
              className={`rounded-xl border px-3 py-1 text-sm font-semibold ${
                eventsConnected
                  ? "border-emerald-300/45 bg-emerald-400/18 text-emerald-100"
                  : "border-slate-300/35 bg-slate-400/12 text-slate-200"
              }`}
            >
              {eventsConnected ? "Events connected" : "Events disconnected"}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-medium text-muted">
              <span className="uppercase tracking-wide text-muted/80">Live Script</span>
              <select
                value={selectedScript}
                onChange={(event) => setSelectedScript(event.target.value as typeof selectedScript)}
                className="rounded-md border border-white/20 bg-black/25 px-2 py-1 text-xs font-semibold text-white outline-none transition focus:border-cyan-300/60"
              >
                <option value="convo">convo</option>
                <option value="convo_short">convo_short</option>
              </select>
            </label>

            <button
              type="button"
              onClick={() => {
                void runLiveDemoWithSound();
              }}
              disabled={isRunning}
              className="rounded-xl border border-cyan-300/45 bg-cyan-400/18 px-4 py-2 text-sm font-semibold text-cyan-100 transition enabled:hover:bg-cyan-400/26 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunning ? "Running live demo..." : "Run live demo + loud playback"}
            </button>

            <button
              type="button"
              onClick={stopPlayback}
              className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 transition hover:bg-white/10"
            >
              Stop loud playback
            </button>

            <button
              type="button"
              onClick={clearTimeline}
              className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-muted transition hover:border-white/40 hover:bg-white/5 hover:text-white"
            >
              Clear timeline
            </button>
          </div>
        </section>

        <ApiStatusLoop steps={Object.values(steps)} />

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <OpsTimeline events={timeline} />

          <section className="card animate-riseIn p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold tracking-tight">Transcript Monitor</h2>
              <p className="text-xs text-muted">{segments.length} final segments</p>
            </div>
            <p className="rounded-xl border border-white/15 bg-white/5 p-2 text-xs text-white/85">
              {partialTranscript ? `Partial: ${partialTranscript}` : "Partial: listening..."}
            </p>
            <div className="mt-3 max-h-[340px] space-y-2 overflow-y-auto pr-1">
              {segments.length === 0 ? (
                <p className="text-sm text-muted">Final transcript segments will appear here.</p>
              ) : (
                segments.map((segment) => (
                  <article key={segment.id} className="rounded-xl border border-white/15 bg-white/5 p-2.5">
                    <p className="text-[11px] text-muted">
                      #{segment.id} • {segment.start_ms ?? 0}ms-{segment.end_ms ?? 0}ms
                    </p>
                    <p className="text-sm text-white/90">{segment.text}</p>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="card animate-riseIn p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold tracking-tight">Output Snapshot</h2>
              <p className="text-xs text-muted">SOAP + risks</p>
            </div>

            <div className="space-y-2 text-sm">
              <div className="rounded-xl border border-white/15 bg-white/5 p-2.5">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Subjective</p>
                {soap.subjective.length === 0 ? (
                  <p className="text-muted">No items</p>
                ) : (
                  <ul className="list-disc pl-4 text-white/90">
                    {soap.subjective.slice(0, 4).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-white/15 bg-white/5 p-2.5">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Assessment</p>
                {soap.assessment.length === 0 ? (
                  <p className="text-muted">No items</p>
                ) : (
                  <ul className="list-disc pl-4 text-white/90">
                    {soap.assessment.slice(0, 4).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-white/15 bg-white/5 p-2.5">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Risks</p>
                {risks.length === 0 ? (
                  <p className="text-muted">No risk signals yet</p>
                ) : (
                  <ul className="space-y-1 text-white/90">
                    {risks.slice(0, 4).map((risk, index) => (
                      <li key={`${risk.label}-${index}`}>
                        <span className="font-semibold">[{risk.severity}]</span> {risk.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

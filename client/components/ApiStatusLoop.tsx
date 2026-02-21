"use client";

import type { ApiStep } from "@/lib/useOpsLiveDemo";

interface ApiStatusLoopProps {
  steps: ApiStep[];
}

function stateClass(state: ApiStep["state"]): string {
  return "border-white/20 bg-white/[0.06] text-white/90";
}

function stateLabel(state: ApiStep["state"]): string {
  if (state === "success") {
    return "green";
  }
  if (state === "running") {
    return "yellow";
  }
  if (state === "error") {
    return "red";
  }
  return "gray";
}

function stateDotClass(state: ApiStep["state"]): string {
  if (state === "success") {
    return "bg-emerald-300";
  }
  if (state === "running") {
    return "bg-amber-300";
  }
  if (state === "error") {
    return "bg-rose-300";
  }
  return "bg-slate-300";
}

export function ApiStatusLoop({ steps }: ApiStatusLoopProps) {
  return (
    <section className="card animate-riseIn p-3.5 sm:p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold tracking-tight sm:text-lg">API Status Loop</h2>
        <p className="text-xs text-muted">Live: gray | yellow | green | red</p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {steps.map((step) => (
          <article key={step.id} className={`rounded-2xl border p-3 transition ${stateClass(step.state)}`}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{step.label}</h3>
              <span className="inline-flex items-center gap-1 rounded-md border border-white/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                <span className={`h-1.5 w-1.5 rounded-full ${stateDotClass(step.state)}`} />
                {stateLabel(step.state)}
              </span>
            </div>
            <p className="text-xs opacity-90">{step.detail}</p>
            <p className="mt-1 text-[10px] opacity-70">{step.updatedAt ? new Date(step.updatedAt).toLocaleTimeString() : "Never"}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

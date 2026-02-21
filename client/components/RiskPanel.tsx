"use client";

import clsx from "clsx";

import type { Risk } from "@/lib/types";

interface RiskPanelProps {
  risks: Risk[];
  lastUpdated: string | null;
  onHighlightEvidence: (segmentIds: number[]) => void;
}

const severityStyles: Record<number, string> = {
  1: "border border-white/20 bg-white/[0.08] text-white/70",
  2: "border border-white/[0.25] bg-white/10 text-white/80",
  3: "border border-white/30 bg-white/[0.12] text-white/90",
  4: "border border-white/[0.35] bg-white/[0.14] text-white",
  5: "border border-rose-300/40 bg-rose-300/[0.14] text-rose-100",
};

export function RiskPanel({ risks, lastUpdated, onHighlightEvidence }: RiskPanelProps) {
  return (
    <section className="card flex h-[62vh] min-h-[380px] flex-col overflow-hidden p-3.5 sm:p-4">
      <div className="mb-3 flex items-end justify-between">
        <h2 className="font-display text-base font-semibold tracking-tight sm:text-lg">Risk + Tasks</h2>
        <p className="text-xs text-muted">{lastUpdated ? `Updated ${formatTime(lastUpdated)}` : "No updates yet"}</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {risks.length === 0 && <p className="text-sm text-muted">No risk signals detected yet.</p>}

        {risks.map((risk, idx) => (
          <article key={`${risk.label}-${idx}`} className="animate-riseIn rounded-xl border border-white/20 bg-white/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-medium leading-tight">{risk.label}</h3>
              <span className={clsx("rounded-full px-2 py-1 text-xs font-semibold", severityStyles[risk.severity])}>
                Sev {risk.severity}
              </span>
            </div>

            <p className="mt-2 text-sm text-text/90">{risk.rationale}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={risk.evidence_segment_ids.length === 0}
                onClick={() => onHighlightEvidence(risk.evidence_segment_ids)}
                className="rounded-md border border-white/20 bg-white/5 px-2 py-1 text-xs font-semibold text-white/90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Highlight evidence
              </button>
            </div>

            {risk.followups.length > 0 && (
              <div className="mt-3">
                <p className="text-xs uppercase tracking-wide text-muted">Follow-up questions</p>
                <ul className="mt-1 space-y-1">
                  {risk.followups.map((question) => (
                    <li key={question} className="text-sm text-text/90">
                      - {question}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-3 text-[11px] text-muted">{risk.disclaimer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

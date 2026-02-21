"use client";

import type { Citation, SoapNote } from "@/lib/types";

interface SoapPanelProps {
  soap: SoapNote;
  citations: Citation[];
  lastUpdated: string | null;
  onHighlightEvidence: (segmentIds: number[]) => void;
}

const sections: Array<{ key: keyof SoapNote; label: string }> = [
  { key: "subjective", label: "Subjective" },
  { key: "objective", label: "Objective" },
  { key: "assessment", label: "Assessment" },
  { key: "plan", label: "Plan" },
];

export function SoapPanel({ soap, citations, lastUpdated, onHighlightEvidence }: SoapPanelProps) {
  return (
    <section className="card flex h-[62vh] min-h-[380px] flex-col overflow-hidden p-3.5 sm:p-4">
      <div className="mb-3 flex items-end justify-between">
        <h2 className="font-display text-base font-semibold tracking-tight sm:text-lg">SOAP Note</h2>
        <p className="text-xs text-muted">{lastUpdated ? `Updated ${formatTime(lastUpdated)}` : "No updates yet"}</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        {sections.map((section) => {
          const bullets = soap[section.key] ?? [];
          return (
            <article key={section.key} className="rounded-xl border border-white/20 bg-white/5 p-3">
              <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-muted">{section.label}</h3>
              <ul className="mt-2 space-y-2">
                {bullets.length === 0 && <li className="text-sm text-muted">No items.</li>}
                {bullets.map((bullet, idx) => {
                  const notePath = `${section.key}[${idx}]`;
                  const evidence = citations.find((citation) => citation.note_path === notePath);
                  return (
                    <li key={notePath} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm leading-relaxed">
                      <div className="flex items-start justify-between gap-3">
                        <span>{bullet}</span>
                        <button
                          type="button"
                          disabled={!evidence || evidence.segment_ids.length === 0}
                          onClick={() => onHighlightEvidence(evidence?.segment_ids ?? [])}
                          className="shrink-0 rounded-md border border-white/20 bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/90 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Evidence
                        </button>
                      </div>
                      {evidence?.quote && <p className="mt-1 text-xs text-muted">"{evidence.quote}"</p>}
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

"use client";

import type { TimelineEvent } from "@/lib/useOpsLiveDemo";

interface OpsTimelineProps {
  events: TimelineEvent[];
}

function levelClass(level: TimelineEvent["level"]): string {
  if (level === "success") {
    return "bg-emerald-300";
  }
  if (level === "warn") {
    return "bg-amber-300";
  }
  if (level === "error") {
    return "bg-rose-300";
  }
  return "bg-slate-300";
}

export function OpsTimeline({ events }: OpsTimelineProps) {
  return (
    <section className="card animate-riseIn p-3.5 sm:p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold tracking-tight sm:text-lg">Event Loop</h2>
        <p className="text-xs text-muted">{events.length} events</p>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-muted">No events yet. Start live demo to populate this loop.</p>
      ) : (
        <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
          {events.map((event) => (
            <article key={event.id} className="rounded-xl border border-white/15 bg-white/5 p-2.5">
              <div className="mb-1 flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${levelClass(event.level)}`} />
                <p className="text-xs font-semibold text-white/90">{event.title}</p>
                <p className="text-[10px] text-muted">{new Date(event.ts).toLocaleTimeString()}</p>
              </div>
              <p className="text-xs text-muted">{event.detail}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

"use client";

import clsx from "clsx";
import { useEffect, useRef } from "react";

import type { Segment } from "@/lib/types";

interface TranscriptPanelProps {
  partialTranscript: string;
  segments: Segment[];
  highlightedSegmentIds: number[];
  autoScroll: boolean;
  setAutoScroll: (enabled: boolean) => void;
}

export function TranscriptPanel({
  partialTranscript,
  segments,
  highlightedSegmentIds,
  autoScroll,
  setAutoScroll,
}: TranscriptPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoScroll || !containerRef.current) {
      return;
    }
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [autoScroll, partialTranscript, segments]);

  return (
    <section className="card flex h-[62vh] min-h-[380px] flex-col overflow-hidden p-3.5 sm:p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold tracking-tight sm:text-lg">Transcript</h2>
        <button
          type="button"
          onClick={() => setAutoScroll(!autoScroll)}
          className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-[11px] font-medium text-muted transition hover:border-white/40 hover:bg-white/10 hover:text-white sm:text-xs"
        >
          {autoScroll ? "Pause scroll" : "Resume scroll"}
        </button>
      </div>

      <div className="rounded-xl border border-white/20 bg-white/5 p-3">
        <p className="text-xs uppercase tracking-wide text-muted">Live partial</p>
        <p className="mt-1 min-h-6 text-sm text-text/90">
          {partialTranscript || <span className="text-muted">Listening...</span>}
          {partialTranscript && <span className="ml-1 inline-block h-2 w-2 animate-pulseDot rounded-full bg-white/90" />}
        </p>
      </div>

      <div ref={containerRef} className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
        {segments.length === 0 && <p className="text-sm text-muted">Final transcript segments will appear here.</p>}
        {segments.map((segment) => {
          const highlighted = highlightedSegmentIds.includes(segment.id);
          return (
            <article
              key={segment.id}
              className={clsx(
                "rounded-xl border border-white/20 bg-white/5 px-3 py-2 transition hover:bg-white/10",
                highlighted && "segment-highlight",
              )}
            >
              <p className="mb-1 text-xs uppercase tracking-wide text-muted">#{segment.id} · {formatRange(segment)}</p>
              <p className="text-sm leading-relaxed">{segment.text}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function formatRange(segment: Segment): string {
  if (segment.start_ms === null || segment.end_ms === null) {
    return "--:--";
  }
  const start = (segment.start_ms / 1000).toFixed(1);
  const end = (segment.end_ms / 1000).toFixed(1);
  return `${start}s-${end}s`;
}

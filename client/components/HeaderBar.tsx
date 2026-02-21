"use client";

import clsx from "clsx";

interface HeaderBarProps {
  status: "idle" | "recording" | "processing" | "error";
  statusMessage: string;
  eventsConnected: boolean;
  eventLatencyMs: number | null;
  isDark: boolean;
  onToggleTheme: () => void;
}

const statusStyles: Record<HeaderBarProps["status"], string> = {
  idle: "border border-white/30 bg-white/10 text-white/90",
  recording: "border border-emerald-400/35 bg-emerald-400/15 text-emerald-200",
  processing: "border border-amber-400/35 bg-amber-400/15 text-amber-200",
  error: "border border-rose-400/40 bg-rose-400/15 text-rose-100",
};

const statusDotStyles: Record<HeaderBarProps["status"], string> = {
  idle: "bg-slate-200",
  recording: "bg-emerald-200",
  processing: "bg-amber-200",
  error: "bg-rose-100",
};

export function HeaderBar({
  status,
  statusMessage,
  eventsConnected,
  eventLatencyMs,
  isDark,
  onToggleTheme,
}: HeaderBarProps) {
  const statusLabel = getStatusLabel(status, statusMessage);

  return (
    <header className="card animate-riseIn flex flex-wrap items-center justify-between gap-2 p-2.5 sm:p-3">
      <div>
        <p className="font-display text-base font-semibold tracking-tight sm:text-lg">PulseScribe</p>
        <p className="text-[11px] text-muted">Ambient Scribe + Risk Sentinel</p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <div className={clsx("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium sm:text-xs", statusStyles[status])}>
          <span
            className={clsx(
              "h-1.5 w-1.5 rounded-full",
              status === "recording" ? "animate-pulseDot" : "",
              statusDotStyles[status],
            )}
          />
          <span>{statusLabel}</span>
        </div>

        <div
          className={clsx(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium sm:text-xs",
            eventsConnected
              ? "border border-emerald-400/40 bg-emerald-400/20 text-emerald-200"
              : "border border-rose-400/40 bg-rose-400/20 text-rose-100",
          )}
        >
          <span className={clsx("h-1.5 w-1.5 rounded-full", eventsConnected ? "bg-emerald-200" : "bg-rose-100")} />
          <span>{eventsConnected ? "Events connected" : "Events disconnected"}</span>
        </div>

        <div className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-[11px] text-muted sm:text-xs">
          {eventLatencyMs !== null ? `Event ${eventLatencyMs}ms` : "Event --"}
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-muted transition hover:border-white/40 hover:bg-white/10 hover:text-white sm:text-xs"
        >
          {isDark ? "Light" : "Dark"} mode
        </button>
      </div>
    </header>
  );
}

function getStatusLabel(status: HeaderBarProps["status"], statusMessage: string): string {
  if (status === "error" && statusMessage && !statusMessage.toLowerCase().includes("events")) {
    return statusMessage;
  }
  if (status === "recording") {
    return "Recording";
  }
  if (status === "processing") {
    return "Processing";
  }
  if (status === "error") {
    return "Error";
  }
  return "Idle";
}

"use client";

interface WarningsPanelProps {
  warnings: string[];
}

export function WarningsPanel({ warnings }: WarningsPanelProps) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <section className="card animate-riseIn border-white/20 bg-white/[0.06] p-3">
      <p className="text-sm font-semibold text-white/90">Non-blocking warnings</p>
      <ul className="mt-2 space-y-1 text-xs text-white/80">
        {warnings.map((warning, idx) => (
          <li key={`${warning}-${idx}`}>- {warning}</li>
        ))}
      </ul>
    </section>
  );
}

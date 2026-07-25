"use client";

type Props = {
  bars: number;
  label?: string;
  compact?: boolean;
};

/** 0–5 bar Wi‑Fi / hotspot signal. */
export function SignalBars({ bars, label, compact }: Props) {
  const n = Math.max(0, Math.min(5, Math.round(bars)));

  return (
    <span
      className="inline-flex items-end gap-[3px] text-[var(--paint)]"
      title={label || `${n}/5`}
      aria-label={label || `Signal ${n} of 5`}
    >
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`w-[2.5px] rounded-[1px] sm:w-[3px] ${
              i <= n ? "bg-current opacity-100" : "bg-current opacity-25"
            }`}
            style={{ height: `${compact ? 4 + i * 1.6 : 6 + i * 2}px` }}
          />
        ))}
      </span>
      {label ? (
        <span
          className={`font-mono tracking-wide text-[var(--paint)]/70 ${
            compact ? "text-[8px]" : "text-[9px]"
          }`}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}

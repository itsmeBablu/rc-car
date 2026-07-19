"use client";

/** True analog needle dial with scale marks */
export function DashGauge({
  label,
  value,
  max,
  unit,
  accent = "yellow",
  /** Evenly spaced major labels (inclusive). Ignored if tickStep set. */
  majorCount = 5,
  /** If set, ticks every tickStep from 0..max (e.g. 0.5 for RPM) */
  tickStep,
  formatMajor,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  accent?: "yellow" | "cyan" | "green" | "red";
  majorCount?: number;
  tickStep?: number;
  formatMajor?: (v: number) => string;
}) {
  const t = Math.max(0, Math.min(1, value / max));
  const angle = -120 + t * 240;
  const colors = {
    yellow: "#f5e000",
    cyan: "#5eead4",
    green: "#34d399",
    red: "#f87171",
  };
  const stroke = colors[accent];
  const low = accent === "green" && t < 0.2;
  const needle = low ? colors.red : stroke;

  const values: number[] = [];
  if (tickStep && tickStep > 0) {
    for (let v = 0; v <= max + 1e-9; v += tickStep) {
      values.push(Math.round(v * 1000) / 1000);
    }
  } else {
    for (let i = 0; i < majorCount; i++) {
      values.push((i / (majorCount - 1)) * max);
    }
  }

  const ticks = values.map((v) => {
    const frac = v / max;
    const a = -120 + frac * 240;
    const rad = ((a - 90) * Math.PI) / 180;
    const major = tickStep
      ? Math.abs(v - Math.round(v)) < 1e-6 || Math.abs(v - max) < 1e-6
      : true;
    const r1 = major ? 33 : 36.5;
    const r2 = 40;
    const labelR = 26.5;
    return {
      x1: 50 + Math.cos(rad) * r1,
      y1: 50 + Math.sin(rad) * r1,
      x2: 50 + Math.cos(rad) * r2,
      y2: 50 + Math.sin(rad) * r2,
      lx: 50 + Math.cos(rad) * labelR,
      ly: 50 + Math.sin(rad) * labelR,
      major,
      text: major
        ? formatMajor
          ? formatMajor(v)
          : String(Math.round(v))
        : null,
    };
  });

  const nRad = ((angle - 90) * Math.PI) / 180;
  const nx = 50 + Math.cos(nRad) * 29;
  const ny = 50 + Math.sin(nRad) * 29;

  return (
    <div className="analog-dial relative flex flex-col items-center">
      <svg viewBox="0 0 100 100" className="h-[7.2rem] w-[7.2rem] sm:h-[7.8rem] sm:w-[7.8rem]">
        <defs>
          <radialGradient id={`face-${label}`} cx="40%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#2a2d34" />
            <stop offset="70%" stopColor="#12141a" />
            <stop offset="100%" stopColor="#070809" />
          </radialGradient>
        </defs>

        <circle cx="50" cy="50" r="48" fill="#1a1c22" stroke="#ffffff22" strokeWidth="1.5" />
        <circle cx="50" cy="50" r="44" fill={`url(#face-${label})`} stroke="#000" strokeWidth="2" />

        {ticks.map((tk, i) => (
          <g key={i}>
            <line
              x1={tk.x1}
              y1={tk.y1}
              x2={tk.x2}
              y2={tk.y2}
              stroke={tk.major ? stroke : "rgba(255,255,255,0.28)"}
              strokeWidth={tk.major ? 1.7 : 0.9}
              strokeLinecap="round"
              opacity={0.9}
            />
            {tk.text != null && tk.text !== "" && (
              <text
                x={tk.lx}
                y={tk.ly}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ fontSize: 5.5, fill: "rgba(255,255,255,0.55)", fontWeight: 600 }}
              >
                {tk.text}
              </text>
            )}
          </g>
        ))}

        <path
          d="M 15.4 70 A 40 40 0 1 1 84.6 70"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="3"
        />

        <line
          x1="50"
          y1="50"
          x2={nx}
          y2={ny}
          stroke={needle}
          strokeWidth="2.4"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 5px ${needle})` }}
        />
        <circle cx="50" cy="50" r="5" fill="#0a0b0e" stroke={needle} strokeWidth="1.5" />
        <circle cx="50" cy="50" r="2.2" fill={needle} />

        <text
          x="50"
          y="78"
          textAnchor="middle"
          style={{ fontSize: 6.5, fill: "rgba(255,255,255,0.4)", letterSpacing: "0.1em" }}
        >
          {unit}
        </text>
      </svg>
      <span className="mt-0.5 text-[9px] uppercase tracking-[0.2em] text-white/50">
        {label}
      </span>
    </div>
  );
}

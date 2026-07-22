"use client";

type Props = {
  speed: number;
  rpm: number;
  fuel: number;
  /** USB plugged into TC4056 */
  usb?: boolean;
  /** Still charging (CHRG) */
  charging?: boolean;
  /** Charge complete (STDBY), USB still in */
  full?: boolean;
};

const SPEED_MAX = 330;
const RPM_MAX = 8;
const FUEL_LABELS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export function AnalogCluster({
  speed,
  rpm,
  fuel,
  usb = false,
  charging = false,
  full = false,
}: Props) {
  const speedT = Math.max(0, Math.min(1, speed / SPEED_MAX));
  const rpmT = Math.max(0, Math.min(1, rpm / RPM_MAX));
  const fuelT = Math.max(0, Math.min(1, fuel / 100));
  const speedNeedle = polar(50, 50, 32, -120 + speedT * 240);
  const rpmNeedle = polar(50, 50, 28, -120 + rpmT * 240);
  const fuelNeedle = polar(50, 50, 26, -120 + fuelT * 240);

  const onUsb = usb || charging || full;
  const isFull = full || (onUsb && !charging && fuel >= 90);

  // USB in: light green while charging; thick green blink when full
  // Unplugged: <30% light red, <10% thick red blink
  const fuelFaceClass = onUsb
    ? isFull
      ? "pc-face pc-face-charge-full"
      : "pc-face pc-face-charging"
    : fuel < 10
      ? "pc-face pc-face-crit"
      : fuel < 30
        ? "pc-face pc-face-low"
        : "pc-face";

  const statusTag = !onUsb
    ? null
    : charging
      ? "CHARGING"
      : isFull
        ? "FULL"
        : "USB";

  return (
    <div className="porsche-cluster">
      <svg className="pc-shell" viewBox="0 0 320 130" preserveAspectRatio="none" aria-hidden>
        <path
          className="pc-shell-fill"
          d="M 0 130
             L 0 78
             A 160 72 0 0 1 320 78
             L 320 130
             Z"
        />
      </svg>

      <div className="pc-dials">
        <div className="pc-dial pc-dial-side">
          <svg viewBox="0 0 100 100" className="pc-dial-svg" aria-hidden>
            <circle cx="50" cy="50" r="46" className="pc-bezel" />
            <circle cx="50" cy="50" r="40" className={fuelFaceClass} />
            {FUEL_LABELS.map((v) => {
              const tk = tickAt(v, 0, 100);
              return (
                <g key={v}>
                  <line
                    x1={tk.x1}
                    y1={tk.y1}
                    x2={tk.x2}
                    y2={tk.y2}
                    className={v <= 30 ? "pc-tick pc-tick-red" : "pc-tick"}
                  />
                  <text
                    x={tk.lx}
                    y={tk.ly}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="pc-tick-label pc-tick-label-fuel"
                  >
                    {v}
                  </text>
                </g>
              );
            })}
            <line
              x1="50"
              y1="50"
              x2={fuelNeedle.x}
              y2={fuelNeedle.y}
              className="pc-needle pc-needle-fuel"
            />
            <circle cx="50" cy="50" r="3" className="pc-hub" />
            {onUsb ? (
              <text x="50" y="68" textAnchor="middle" className="pc-fuel-digital">
                {Math.round(fuel)}%
              </text>
            ) : (
              <text x="50" y="72" textAnchor="middle" className="pc-unit">
                FUEL
              </text>
            )}
          </svg>
          {statusTag ? (
            <span
              className={`pc-fuel-chg-tag${charging ? " is-charging" : ""}${isFull ? " is-full" : ""}`}
            >
              {statusTag}
            </span>
          ) : null}
        </div>

        <div className="pc-dial pc-dial-center">
          <svg viewBox="0 0 100 100" className="pc-dial-svg" aria-hidden>
            <circle cx="50" cy="50" r="48" className="pc-bezel pc-bezel-main" />
            <circle cx="50" cy="50" r="42" className="pc-face" />

            {scaleTicks(0, SPEED_MAX, 7).map((tk) => (
              <g key={tk.v}>
                <line x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2} className="pc-tick" />
                <text
                  x={tk.lx}
                  y={tk.ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="pc-tick-label"
                >
                  {Math.round(tk.v)}
                </text>
              </g>
            ))}

            <line
              x1="50"
              y1="50"
              x2={speedNeedle.x}
              y2={speedNeedle.y}
              className="pc-needle pc-needle-speed"
            />
            <circle cx="50" cy="50" r="3.8" className="pc-hub" />
          </svg>

          <div className="pc-center-overlay">
            <span className="pc-brand">GT2</span>
            <span className="pc-speed-unit">km/h</span>
            <div className="pc-batt-row">
              <span className="pc-batt-icon" />
              <div className="pc-batt-bar">
                <div
                  className={`pc-batt-fill${onUsb ? (isFull ? " is-charge-full" : " is-charging") : ""}${!onUsb && fuel < 30 ? " is-low" : ""}`}
                  style={{ width: `${Math.max(4, fuel)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="pc-dial pc-dial-side pc-dial-right">
          <svg viewBox="0 0 100 100" className="pc-dial-svg" aria-hidden>
            <circle cx="50" cy="50" r="46" className="pc-bezel" />
            <circle cx="50" cy="50" r="40" className="pc-face" />
            {scaleTicks(0, RPM_MAX, 5).map((tk) => (
              <g key={tk.v}>
                <line
                  x1={tk.x1}
                  y1={tk.y1}
                  x2={tk.x2}
                  y2={tk.y2}
                  className={tk.v >= 7 ? "pc-tick pc-tick-red" : "pc-tick"}
                />
                <text
                  x={tk.lx}
                  y={tk.ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="pc-tick-label"
                >
                  {tk.v}
                </text>
              </g>
            ))}
            <path
              d="M 72 16 A 40 40 0 0 1 88 38"
              fill="none"
              stroke="#e11d48"
              strokeWidth="2.5"
              strokeLinecap="round"
              opacity="0.85"
            />
            <line
              x1="50"
              y1="50"
              x2={rpmNeedle.x}
              y2={rpmNeedle.y}
              className="pc-needle pc-needle-rpm"
            />
            <circle cx="50" cy="50" r="3" className="pc-hub" />
            <text x="50" y="72" textAnchor="middle" className="pc-unit">
              ×1000
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
}

function r3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: r3(cx + Math.cos(rad) * r), y: r3(cy + Math.sin(rad) * r) };
}

function tickAt(v: number, from: number, to: number) {
  const frac = (v - from) / (to - from || 1);
  const a = -120 + frac * 240;
  const rad = ((a - 90) * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x1: r3(50 + c * 34),
    y1: r3(50 + s * 34),
    x2: r3(50 + c * 40),
    y2: r3(50 + s * 40),
    lx: r3(50 + c * 26),
    ly: r3(50 + s * 26),
  };
}

function scaleTicks(from: number, to: number, count: number) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const v = from + (i / Math.max(1, count - 1)) * (to - from);
    const frac = (v - from) / (to - from || 1);
    const a = -120 + frac * 240;
    const rad = ((a - 90) * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    out.push({
      v: Math.round(v * 10) / 10,
      x1: r3(50 + c * 34),
      y1: r3(50 + s * 34),
      x2: r3(50 + c * 40),
      y2: r3(50 + s * 40),
      lx: r3(50 + c * 26),
      ly: r3(50 + s * 26),
    });
  }
  return out;
}

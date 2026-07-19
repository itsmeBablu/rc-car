"use client";

import { useRef, type PointerEvent } from "react";
import { WHEEL_LOCK_TO_LOCK_DEG } from "@/lib/protocol";

type Props = {
  wheelDeg: number;
  onWheelDeg: (deg: number) => void;
  onRelease: () => void;
  debug?: boolean;
};

function angleFromPointer(clientX: number, clientY: number, rect: DOMRect): number {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const rad = Math.atan2(clientY - cy, clientX - cx);
  return ((rad * 180) / Math.PI + 90 + 360) % 360;
}

function shortestDelta(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** Classic 3-spoke spoke path from hub toward angle (deg, 0=up) */
function spokePath(angleDeg: number, inner = 22, outer = 72, halfW = 9): string {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const tx = Math.cos(rad);
  const ty = Math.sin(rad);
  const px = -ty;
  const py = tx;
  const cx = 100;
  const cy = 100;
  const ix = cx + tx * inner;
  const iy = cy + ty * inner;
  const ox = cx + tx * outer;
  const oy = cy + ty * outer;
  const hwI = halfW * 0.55;
  const hwO = halfW;
  return [
    `M ${ix + px * hwI} ${iy + py * hwI}`,
    `L ${ox + px * hwO} ${oy + py * hwO}`,
    `L ${ox - px * hwO} ${oy - py * hwO}`,
    `L ${ix - px * hwI} ${iy - py * hwI}`,
    "Z",
  ].join(" ");
}

export function SteeringWheel({ wheelDeg, onWheelDeg, onRelease, debug }: Props) {
  const rimRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPointerAngle = useRef(0);
  const halfLock = WHEEL_LOCK_TO_LOCK_DEG / 2;

  const clampWheel = (deg: number) => Math.max(-halfLock, Math.min(halfLock, deg));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!rimRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    lastPointerAngle.current = angleFromPointer(
      e.clientX,
      e.clientY,
      rimRef.current.getBoundingClientRect(),
    );
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !rimRef.current) return;
    const next = angleFromPointer(
      e.clientX,
      e.clientY,
      rimRef.current.getBoundingClientRect(),
    );
    const delta = shortestDelta(lastPointerAngle.current, next);
    lastPointerAngle.current = next;
    onWheelDeg(clampWheel(wheelDeg + delta));
  };

  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onRelease();
  };

  // 3 spokes: top, lower-left (~210°), lower-right (~150°) — classic GT
  const spokes = [0, 140, 220];

  return (
    <div className="relative flex flex-col items-center">
      <div
        ref={rimRef}
        className="wheel wheel-3d wheel-gloss relative h-[min(58dvh,333px)] w-[min(58dvh,333px)] touch-none select-none"
        style={{ transform: `rotate(${wheelDeg}deg)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="slider"
        aria-label="Steering wheel"
        aria-valuemin={-halfLock}
        aria-valuemax={halfLock}
        aria-valuenow={Math.round(wheelDeg)}
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 200 200"
          aria-hidden
        >
          <defs>
            <radialGradient id="rim3d" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="rgba(120, 128, 140, 0.8)" />
              <stop offset="40%" stopColor="rgba(50, 54, 64, 0.8)" />
              <stop offset="100%" stopColor="rgba(14, 16, 20, 0.8)" />
            </radialGradient>
            <linearGradient id="spkFace" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(90, 96, 110, 0.8)" />
              <stop offset="50%" stopColor="rgba(32, 36, 44, 0.8)" />
              <stop offset="100%" stopColor="rgba(12, 14, 18, 0.8)" />
            </linearGradient>
            <linearGradient id="spkLit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255, 255, 255, 0.45)" />
              <stop offset="50%" stopColor="rgba(255, 255, 255, 0)" />
            </linearGradient>
            <linearGradient id="rimGloss" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255, 255, 255, 0.35)" />
              <stop offset="40%" stopColor="rgba(255, 255, 255, 0)" />
            </linearGradient>
            <filter id="d3" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="2" dy="3" stdDeviation="2.2" floodColor="#000" floodOpacity="0.4" />
            </filter>
          </defs>

          {/* Rim ring only — center between spokes stays open to the video */}
          <path
            d="M100 9 A91 91 0 1 1 99.99 9 Z M100 30 A70 70 0 1 0 100.01 30 Z"
            fill="url(#rim3d)"
            fillRule="evenodd"
            filter="url(#d3)"
          />
          <path
            d="M100 9 A91 91 0 1 1 99.99 9 Z M100 30 A70 70 0 1 0 100.01 30 Z"
            fill="url(#rimGloss)"
            fillRule="evenodd"
          />
          <circle cx="100" cy="100" r="91" fill="none" stroke="rgba(245, 224, 0, 0.45)" strokeWidth="2.5" />
          {/* Leather grip thickness */}
          <circle cx="100" cy="100" r="82" fill="none" stroke="rgba(255, 255, 255, 0.12)" strokeWidth="14" />
          <circle cx="100" cy="100" r="82" fill="none" stroke="rgba(255, 255, 255, 0.22)" strokeWidth="2" />
          <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(0, 0, 0, 0.35)" strokeWidth="4" />

          {/* Top mark */}
          <rect x="96" y="12" width="8" height="14" rx="2" fill="rgba(245, 224, 0, 0.85)" />

          {/* Exactly 3 spokes */}
          {spokes.map((a) => (
            <g key={a} filter="url(#d3)">
              <path d={spokePath(a, 24, 70, 10)} fill="url(#spkFace)" stroke="rgba(196, 165, 116, 0.35)" strokeWidth="1" />
              <path d={spokePath(a, 28, 66, 5)} fill="url(#spkLit)" />
            </g>
          ))}

          {/* Hub */}
          <circle cx="100" cy="100" r="26" fill="rgba(40, 34, 28, 0.8)" stroke="rgba(245, 224, 0, 0.75)" strokeWidth="2.4" filter="url(#d3)" />
          <circle cx="100" cy="100" r="18" fill="rgba(14, 12, 10, 0.8)" />
          <circle cx="93" cy="93" r="5" fill="rgba(255, 255, 255, 0.28)" />
          <text
            x="100"
            y="104"
            textAnchor="middle"
            fill="rgba(245, 224, 0, 0.9)"
            style={{ fontSize: 10, fontFamily: "var(--font-display)", letterSpacing: "0.08em" }}
          >
            GT2
          </text>
        </svg>
      </div>
      {debug && (
        <p className="mt-1 font-mono text-[10px] text-[var(--rim)]">{wheelDeg.toFixed(0)}°</p>
      )}
    </div>
  );
}

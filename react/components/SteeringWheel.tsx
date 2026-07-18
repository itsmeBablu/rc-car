"use client";

import { useRef, type PointerEvent } from "react";
import { WHEEL_LOCK_TO_LOCK_DEG } from "@/lib/protocol";

type Props = {
  wheelDeg: number;
  onWheelDeg: (deg: number) => void;
  onRelease: () => void;
  debug?: boolean;
};

function angleFromPointer(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): number {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // atan2: 0 at right, we want 0 at top → subtract 90°
  const rad = Math.atan2(clientY - cy, clientX - cx);
  return ((rad * 180) / Math.PI + 90 + 360) % 360;
}

function shortestDelta(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

export function SteeringWheel({ wheelDeg, onWheelDeg, onRelease, debug }: Props) {
  const rimRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPointerAngle = useRef(0);
  const halfLock = WHEEL_LOCK_TO_LOCK_DEG / 2;

  const clampWheel = (deg: number) =>
    Math.max(-halfLock, Math.min(halfLock, deg));

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

  return (
    <div className="relative flex flex-col items-center gap-3">
      <div
        ref={rimRef}
        className="wheel relative h-[min(42vh,280px)] w-[min(42vh,280px)] touch-none select-none"
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
        <div className="wheel-rim absolute inset-0 rounded-full" />
        <div className="wheel-hub absolute left-1/2 top-1/2 h-[28%] w-[28%] -translate-x-1/2 -translate-y-1/2 rounded-full" />
        <div className="wheel-spoke absolute left-1/2 top-[8%] h-[34%] w-[10%] -translate-x-1/2 rounded-sm" />
        <div className="wheel-spoke absolute left-1/2 bottom-[8%] h-[34%] w-[10%] -translate-x-1/2 rounded-sm" />
        <div className="wheel-spoke absolute left-[8%] top-1/2 h-[10%] w-[34%] -translate-y-1/2 rounded-sm" />
        <div className="wheel-spoke absolute right-[8%] top-1/2 h-[10%] w-[34%] -translate-y-1/2 rounded-sm" />
        <div className="wheel-mark absolute left-1/2 top-[3%] h-3 w-1.5 -translate-x-1/2 rounded-sm bg-[var(--paint)]" />
      </div>
      {debug && (
        <p className="font-mono text-xs text-[var(--rim)]">
          wheel {wheelDeg.toFixed(1)}° · ±{halfLock}° lock
        </p>
      )}
    </div>
  );
}

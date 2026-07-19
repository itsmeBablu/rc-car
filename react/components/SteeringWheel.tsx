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

  return (
    <div className="relative flex flex-col items-center">
      <div
        ref={rimRef}
        className="wheel wheel-3d wheel-gloss relative h-[min(37.12dvh,213px)] w-[min(37.12dvh,213px)] touch-none select-none"
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
        {/* Yellow outline (theme) */}
        <span className="steer-svg-mask steer-svg-paint" aria-hidden />
        {/* Black face */}
        <span className="steer-svg-mask steer-svg-ink" aria-hidden />
        {/* GT2 stays centered on the hub */}
        <span className="steer-hub-label" aria-hidden>
          GT2
        </span>
      </div>
      {debug && (
        <p className="mt-1 font-mono text-[10px] text-[var(--paint)]">
          {wheelDeg.toFixed(0)}°
        </p>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MOTOR_MAX } from "@/lib/protocol";

type Gear = "D" | "R";

type Props = {
  enabled: boolean;
  onDrive: (left: number, right: number) => void;
  onStop: () => void;
  speed?: number;
};

export function MotorPanel({
  enabled,
  onDrive,
  onStop,
  speed = Math.round(MOTOR_MAX * 0.85),
}: Props) {
  const [gear, setGear] = useState<Gear>("D");
  const [accel, setAccel] = useState(false);
  const gearRef = useRef(gear);
  const accelRef = useRef(accel);
  const onDriveRef = useRef(onDrive);
  const onStopRef = useRef(onStop);
  const draggedRef = useRef(false);
  gearRef.current = gear;
  accelRef.current = accel;
  onDriveRef.current = onDrive;
  onStopRef.current = onStop;

  const applyAccel = (active: boolean) => {
    if (!enabled && active) return;
    setAccel(active);
    accelRef.current = active;
    if (!active) {
      onStopRef.current();
      return;
    }
    const s = gearRef.current === "R" ? -speed : speed;
    onDriveRef.current(s, s);
  };

  useEffect(() => {
    if (!accel || !enabled) return;
    const s = gear === "R" ? -speed : speed;
    onDriveRef.current(s, s);
  }, [gear, accel, enabled, speed]);

  useEffect(() => {
    const release = () => {
      if (accelRef.current) {
        setAccel(false);
        accelRef.current = false;
        onStopRef.current();
      }
    };
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("blur", release);
      release();
    };
  }, []);

  const selectGear = (next: Gear) => {
    if (!enabled || next === gearRef.current) return;
    setGear(next);
  };

  const onKnobPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!enabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggedRef.current = false;
    const startY = e.clientY;
    const startGear = gearRef.current;

    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > 8) draggedRef.current = true;
      if (dy < -18) selectGear("R");
      else if (dy > 18) selectGear("D");
      else selectGear(startGear);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <section className="flex w-full flex-col gap-4 border border-white/10 bg-black/35 p-4">
      <p className="font-[family-name:var(--font-display)] text-sm tracking-wider text-[var(--paint)]">
        DRIVE
      </p>

      <div className="flex items-stretch gap-4">
        <div
          className={`gear-gate relative flex w-16 shrink-0 flex-col justify-between py-1 ${
            enabled ? "" : "opacity-40"
          }`}
          role="group"
          aria-label="Gear selector"
        >
          <button
            type="button"
            disabled={!enabled}
            onClick={() => selectGear("R")}
            className={`gear-label z-10 text-center text-sm font-bold tracking-widest ${
              gear === "R" ? "text-amber-300" : "text-white/35"
            }`}
          >
            R
          </button>

          <div className="gear-slot absolute inset-x-1/2 top-7 bottom-7 w-1.5 -translate-x-1/2 rounded-full" />

          <button
            type="button"
            disabled={!enabled}
            aria-pressed={gear === "R"}
            onPointerDown={onKnobPointerDown}
            onClick={() => {
              if (draggedRef.current) return;
              selectGear(gear === "R" ? "D" : "R");
            }}
            className={`gear-knob absolute left-1/2 z-20 h-7 w-7 -translate-x-1/2 rounded-full transition-[top] duration-200 ease-out ${
              gear === "R" ? "top-6" : "top-[calc(100%-2.75rem)]"
            }`}
            title="Slide up = R · down = D"
          />

          <button
            type="button"
            disabled={!enabled}
            onClick={() => selectGear("D")}
            className={`gear-label z-10 text-center text-sm font-bold tracking-widest ${
              gear === "D" ? "text-emerald-300" : "text-white/35"
            }`}
          >
            D
          </button>
        </div>

        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
          <button
            type="button"
            disabled={!enabled}
            className={`select-none border py-8 text-sm font-semibold tracking-widest uppercase disabled:opacity-40 ${
              accel
                ? "border-[var(--paint)] bg-[var(--paint)]/25 text-[var(--paint)]"
                : "border-white/25 text-white/80 active:bg-white/10"
            }`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              applyAccel(true);
            }}
            onPointerUp={() => applyAccel(false)}
            onPointerCancel={() => applyAccel(false)}
            onContextMenu={(e) => e.preventDefault()}
          >
            Accel
          </button>

          <button
            type="button"
            disabled={!enabled}
            className="select-none border border-red-400/50 py-8 text-sm font-semibold tracking-widest uppercase text-red-300 active:bg-red-400/20 disabled:opacity-40"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setAccel(false);
              accelRef.current = false;
              onStopRef.current();
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            Brake
          </button>
        </div>
      </div>

      <p className="text-center text-[11px] text-white/35">
        {gear === "D" ? "D — forward" : "R — reverse"} · both motors
      </p>
    </section>
  );
}

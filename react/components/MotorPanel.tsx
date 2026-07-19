"use client";

import { useEffect, useRef, useState } from "react";
import { MOTOR_MAX } from "@/lib/protocol";

type Gear = "D" | "R";

type Props = {
  enabled: boolean;
  gear: Gear;
  onGearChange: (g: Gear) => void;
  onDrive: (left: number, right: number) => void;
  onStop: () => void;
  speed?: number;
};

function PedalIcon({ kind }: { kind: "accel" | "brake" }) {
  if (kind === "brake") {
    return (
      <svg viewBox="0 0 48 64" className="h-10 w-7" aria-hidden>
        <rect x="10" y="4" width="28" height="52" rx="4" fill="currentColor" opacity="0.95" />
        <rect x="14" y="12" width="20" height="3" rx="1" fill="#fff" opacity="0.15" />
        <rect x="14" y="20" width="20" height="3" rx="1" fill="#fff" opacity="0.15" />
        <rect x="14" y="28" width="20" height="3" rx="1" fill="#fff" opacity="0.15" />
        <rect x="14" y="36" width="20" height="3" rx="1" fill="#fff" opacity="0.15" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 64" className="h-11 w-8" aria-hidden>
      <path
        d="M14 6h20c2 0 4 2 4 4v36c0 6-5 12-14 12S10 52 10 46V10c0-2 2-4 4-4z"
        fill="currentColor"
        opacity="0.95"
      />
      <path
        d="M18 14h12M18 22h12M18 30h12M18 38h12"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.2"
      />
    </svg>
  );
}

export function MotorPanel({
  enabled,
  gear,
  onGearChange,
  onDrive,
  onStop,
  speed = Math.round(MOTOR_MAX * 0.85),
}: Props) {
  const [accel, setAccel] = useState(false);
  const gearRef = useRef(gear);
  const accelRef = useRef(accel);
  const onDriveRef = useRef(onDrive);
  const onStopRef = useRef(onStop);
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

  return (
    <section className="pedal-stack flex flex-col items-end justify-end">
      <div className="flex items-end gap-2.5">
        <button
          type="button"
          disabled={!enabled}
          className="gear-gate"
          onClick={() => onGearChange(gear === "D" ? "R" : "D")}
          aria-label={gear === "D" ? "Switch to Reverse" : "Switch to Drive"}
          aria-pressed={gear === "R"}
        >
          <span className="gear-gate-rail" aria-hidden />
          <span
            className={`gear-pos ${gear === "R" ? "is-active is-r" : ""}`}
            aria-hidden
          >
            <span className="gear-pos-letter">R</span>
            <span className="gear-pos-name">Rev</span>
          </span>
          <span
            className={`gear-indicator ${gear === "R" ? "at-r" : "at-d"}`}
            aria-hidden
          />
          <span
            className={`gear-pos ${gear === "D" ? "is-active is-d" : ""}`}
            aria-hidden
          >
            <span className="gear-pos-letter">D</span>
            <span className="gear-pos-name">Drive</span>
          </span>
        </button>

        <button
          type="button"
          disabled={!enabled}
          className="pedal pedal-brake glass-pedal pedal-lg disabled:opacity-40"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setAccel(false);
            accelRef.current = false;
            onStopRef.current();
          }}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Brake"
        >
          <PedalIcon kind="brake" />
          <span className="pedal-label">Brake</span>
        </button>

        <button
          type="button"
          disabled={!enabled}
          className={`pedal pedal-accel glass-pedal pedal-lg disabled:opacity-40 ${accel ? "is-pressed" : ""}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            applyAccel(true);
          }}
          onPointerUp={() => applyAccel(false)}
          onPointerCancel={() => applyAccel(false)}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Throttle"
        >
          <PedalIcon kind="accel" />
          <span className="pedal-label">Gas</span>
        </button>
      </div>
    </section>
  );
}

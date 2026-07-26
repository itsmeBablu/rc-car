"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { DriveModeSwitch } from "@/components/DriveModeSwitch";
import { Glass } from "@/components/Glass";
import type { DriveModeId } from "@/lib/drivePhysics";

type Gear = "D" | "R";

type Props = {
  enabled: boolean;
  gear: Gear;
  onGearChange: (g: Gear) => void;
  driveMode: DriveModeId;
  onDriveModeChange: (m: DriveModeId) => void;
  pedalDown: boolean;
  braking: boolean;
  /** 0..1 eased output — for pressed styling */
  output: number;
  onPedal: (down: boolean) => void;
  onBrake: (down: boolean) => void;
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

function PedalGlass({
  children,
  radius,
}: {
  children: ReactNode;
  radius: number;
}) {
  return (
    <Glass borderRadius={radius} zIndex={1} className="h-full w-full pointer-events-none" fill={false}>
      <span className="pedal-liquid-inner">{children}</span>
    </Glass>
  );
}

export function MotorPanel({
  enabled,
  gear,
  onGearChange,
  driveMode,
  onDriveModeChange,
  pedalDown,
  braking,
  output,
  onPedal,
  onBrake,
}: Props) {
  const onPedalRef = useRef(onPedal);
  const onBrakeRef = useRef(onBrake);
  onPedalRef.current = onPedal;
  onBrakeRef.current = onBrake;

  useEffect(() => {
    const release = () => {
      onPedalRef.current(false);
      onBrakeRef.current(false);
    };
    window.addEventListener("blur", release);
    const onVis = () => {
      if (document.visibilityState === "hidden") release();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVis);
      release();
    };
  }, []);

  return (
    <section className="pedal-stack flex flex-col items-end justify-end gap-2">
      <DriveModeSwitch
        mode={driveMode}
        onChange={onDriveModeChange}
        disabled={!enabled}
      />

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
          className={`pedal pedal-brake glass-pedal pedal-lg pedal-liquid disabled:opacity-40 ${braking ? "is-pressed" : ""}`}
          style={{ touchAction: "none" }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            onPedal(false);
            onBrake(true);
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            onBrake(false);
          }}
          onPointerCancel={() => onBrake(false)}
          onLostPointerCapture={() => onBrake(false)}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Brake"
          aria-pressed={braking}
        >
          <PedalGlass radius={8}>
            <PedalIcon kind="brake" />
            <span className="pedal-label">Brake</span>
          </PedalGlass>
        </button>

        <button
          type="button"
          disabled={!enabled}
          className={`pedal pedal-accel glass-pedal pedal-lg pedal-liquid disabled:opacity-40 ${pedalDown || output > 0.02 ? "is-pressed" : ""}`}
          style={{ touchAction: "none" }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            onBrake(false);
            onPedal(true);
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            onPedal(false);
          }}
          onPointerCancel={() => onPedal(false)}
          onLostPointerCapture={() => onPedal(false)}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Throttle"
          aria-pressed={pedalDown}
        >
          <PedalGlass radius={14}>
            <PedalIcon kind="accel" />
            <span className="pedal-label">Gas</span>
          </PedalGlass>
        </button>
      </div>
    </section>
  );
}

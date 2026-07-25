"use client";

import type { DriveModeId } from "@/lib/drivePhysics";

type Props = {
  mode: DriveModeId;
  onChange: (mode: DriveModeId) => void;
  disabled?: boolean;
};

const MODES: { id: DriveModeId; label: string; tag: string }[] = [
  { id: "NORMAL", label: "Normal", tag: "N" },
  { id: "SPORT", label: "Sport", tag: "S" },
];

/** Hints under the toggle (matches accel keyframes). */
export const DRIVE_MODE_HINT: Record<DriveModeId, string> = {
  NORMAL: "2s → 75% · 3.5s → 100%",
  SPORT: "1s 70% · 2s 90% · 3s 100%",
};

export function DriveModeSwitch({ mode, onChange, disabled }: Props) {
  return (
    <div
      className={`drive-mode-toggle${mode === "SPORT" ? " is-sport" : ""}${disabled ? " is-disabled" : ""}`}
      role="group"
      aria-label="Drive mode"
    >
      {MODES.map((m) => {
        const on = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            className={`drive-mode-btn${on ? " is-on" : ""}`}
            onClick={() => onChange(m.id)}
          >
            <span className="drive-mode-tag">{m.tag}</span>
            <span className="drive-mode-label">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export type { DriveModeId };

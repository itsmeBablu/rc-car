"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type DriveModeId = "NORMAL" | "SPORT" | "CRAWL";

export const DRIVE_MODES: {
  id: DriveModeId;
  label: string;
  tag: string;
  hint: string;
}[] = [
  { id: "NORMAL", label: "Normal", tag: "N", hint: "Smooth · 70%" },
  { id: "SPORT", label: "Sport", tag: "S", hint: "Full · sharp" },
  { id: "CRAWL", label: "Crawl", tag: "C", hint: "Precise · 40%" },
];

/** Keep in sync with CSS --dm-item-h */
const ITEM_H = 32;

type Props = {
  mode: DriveModeId;
  onChange: (mode: DriveModeId) => void;
  disabled?: boolean;
};

function indexOf(mode: DriveModeId) {
  const i = DRIVE_MODES.findIndex((m) => m.id === mode);
  return i < 0 ? 0 : i;
}

export function DriveModeSwitch({ mode, onChange, disabled }: Props) {
  const idx = indexOf(mode);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startDrag = useRef(0);

  useEffect(() => {
    if (!dragging) setDragY(0);
  }, [mode, dragging]);

  const commitFromOffset = useCallback(
    (offsetPx: number) => {
      const delta = Math.round(-offsetPx / ITEM_H);
      const next = Math.max(0, Math.min(DRIVE_MODES.length - 1, idx + delta));
      setDragY(0);
      setDragging(false);
      if (next !== idx) onChange(DRIVE_MODES[next]!.id);
    },
    [idx, onChange],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    startDrag.current = dragY;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || disabled) return;
    const dy = e.clientY - startY.current;
    const raw = startDrag.current + dy;
    const min = -(DRIVE_MODES.length - 1 - idx) * ITEM_H - 8;
    const max = idx * ITEM_H + 8;
    setDragY(Math.max(min, Math.min(max, raw)));
  };

  const onPointerUp = () => {
    if (!dragging) return;
    commitFromOffset(dragY);
  };

  const step = (dir: -1 | 1) => {
    if (disabled) return;
    const next = Math.max(0, Math.min(DRIVE_MODES.length - 1, idx + dir));
    if (next !== idx) onChange(DRIVE_MODES[next]!.id);
  };

  const translateY = -idx * ITEM_H + dragY;
  const active = DRIVE_MODES[idx]!;
  const tone =
    active.id === "SPORT" ? "sport" : active.id === "CRAWL" ? "crawl" : "normal";

  return (
    <div
      className={`drive-odo is-${tone}${disabled ? " is-disabled" : ""}`}
      aria-label="Driving mode"
      title={active.hint}
    >
      <div
        className="drive-odo-window"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="listbox"
        aria-activedescendant={`drive-mode-${active.id}`}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            step(-1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            step(1);
          }
        }}
      >
        <div className="drive-odo-rim drive-odo-rim-l" aria-hidden />
        <div className="drive-odo-rim drive-odo-rim-r" aria-hidden />
        <div className="drive-odo-mask" aria-hidden />
        <div className="drive-odo-glass" aria-hidden />

        <div
          className={`drive-odo-drum${dragging ? " is-dragging" : ""}`}
          style={{ transform: `translate3d(0, ${translateY}px, 0)` }}
        >
          {DRIVE_MODES.map((m, i) => {
            const dist = Math.abs(i - idx - dragY / ITEM_H);
            const isCenter = dist < 0.45;
            return (
              <div
                key={m.id}
                id={`drive-mode-${m.id}`}
                role="option"
                aria-selected={i === idx}
                className={`drive-odo-item${isCenter ? " is-center" : ""}`}
                style={{
                  opacity: Math.max(0.15, 1 - dist * 0.75),
                  transform: `scale(${Math.max(0.72, 1 - dist * 0.22)})`,
                }}
              >
                <span className="drive-odo-tag">{m.tag}</span>
                <span className="drive-odo-name">{m.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

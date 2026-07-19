"use client";

import type { ConnectionState } from "@/hooks/useCarSocket";

type Props = {
  state: ConnectionState;
  transport: "wifi" | "ble" | "none";
  wifiLabel?: string;
  live?: boolean;
  onOpenLink: () => void;
};

export function LinkDock({ state, transport, wifiLabel, live = false, onOpenLink }: Props) {
  const linked = state === "open";
  const sub =
    transport === "wifi"
      ? wifiLabel?.replace(/^ws:\/\//, "") || "WiFi"
      : transport === "ble"
        ? "Bluetooth"
        : "Not linked";

  return (
    <button
      type="button"
      onClick={onOpenLink}
      className="live-link glass-pill group flex items-center gap-2 px-2.5 py-1.5 text-left"
      aria-label="Open link settings"
    >
      <span className={`live-beacon compact ${live ? "is-live" : ""}`} aria-hidden={!live}>
        <span className="live-wave" />
        <span className="live-wave live-wave-2" />
        <span className="live-core" />
        <span className="live-text">{live ? "LIVE" : "OFF"}</span>
      </span>

      <span className="h-5 w-px bg-white/15" aria-hidden />

      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
        <span
          className={`absolute inset-0 rounded-full ${linked ? "bg-emerald-400/25" : "bg-amber-400/20"} blur-[5px]`}
        />
        <span
          className={`relative h-2 w-2 rounded-full ${linked ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`}
        />
      </span>

      <span className="min-w-0">
        <span className="block font-[family-name:var(--font-display)] text-[10px] tracking-wide text-white/90">
          Link
        </span>
        <span className="block max-w-[7.5rem] truncate text-[9px] text-white/45">
          {linked ? sub : state === "connecting" ? "Connecting…" : "Tap to connect"}
        </span>
      </span>

      <span className="ml-0.5 text-white/30 transition group-active:translate-x-0.5">›</span>
    </button>
  );
}

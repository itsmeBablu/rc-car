"use client";

import { Glass } from "@/components/Glass";
import type { ConnectionState } from "@/hooks/useCarSocket";
import type { LinkMode } from "@/lib/protocol";

type Props = {
  state: ConnectionState;
  mode: LinkMode;
  wifiLabel?: string;
  live?: boolean;
  expanded?: boolean;
  onOpenLink: () => void;
};

export function LinkDock({
  state,
  mode,
  wifiLabel,
  live = false,
  expanded = false,
  onOpenLink,
}: Props) {
  const linked = state === "open";
  const sub = linked
    ? mode === "hotspot"
      ? wifiLabel || "Hotspot"
      : wifiLabel || "Home Wi‑Fi"
    : "Not linked";

  return (
    <button
      type="button"
      data-link-anchor="true"
      onClick={onOpenLink}
      className={`live-link link-dock-liquid group w-full overflow-hidden rounded-full text-left${expanded ? " link-dock-ghost" : ""}`}
      aria-label="Open link settings"
      aria-expanded={expanded}
    >
      <Glass borderRadius={999} zIndex={2} className="h-full w-full">
        <span className="lg-fill lg-fill-row gap-2 px-2.5 py-1.5">
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
        </span>
      </Glass>
    </button>
  );
}

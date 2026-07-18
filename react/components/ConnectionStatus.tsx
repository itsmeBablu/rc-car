"use client";

import type { ConnectionState } from "@/hooks/useCarSocket";

const LABELS: Record<ConnectionState, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  open: "Connected",
  closed: "Reconnecting…",
  error: "Error — retrying…",
};

export function ConnectionStatus({
  state,
  url,
}: {
  state: ConnectionState;
  url: string;
}) {
  const ok = state === "open";
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`h-2.5 w-2.5 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`}
        aria-hidden
      />
      <span className="text-[var(--paint)]">{LABELS[state]}</span>
      <span className="hidden font-mono text-xs text-white/40 sm:inline">
        {url}
      </span>
    </div>
  );
}

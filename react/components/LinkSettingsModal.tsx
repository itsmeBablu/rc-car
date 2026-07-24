"use client";

import { useEffect, useRef, useState } from "react";
import { ToggleSwitch } from "@/components/ToggleSwitch";
import type { ConnectionState } from "@/hooks/useCarSocket";
import {
  AP_HOST,
  AP_PASS,
  AP_SSID,
  hostToHttpBase,
  hostToWsUrl,
  type LinkMode,
} from "@/lib/protocol";

type CarStatus = {
  mode?: string;
  apIp?: string;
  ip?: string;
  ssid?: string;
  home?: boolean;
  batt?: number;
  ws?: string;
  wsHome?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  mode: LinkMode;
  host: string;
  wsState: ConnectionState;
  linked: boolean;
  debug: boolean;
  onDebugChange: (v: boolean) => void;
  onConnectHotspot: () => void;
  onConnectHome: (host: string) => void;
  onDisconnect: () => void;
};

export function LinkSettingsModal({
  open,
  onClose,
  mode,
  host,
  wsState,
  linked,
  debug,
  onDebugChange,
  onConnectHotspot,
  onConnectHome,
  onDisconnect,
}: Props) {
  const [tab, setTab] = useState<LinkMode>(mode);
  const [homeHost, setHomeHost] = useState(host || "");
  const [status, setStatus] = useState<CarStatus | null>(null);
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) {
      setTab(mode);
      setHomeHost(host || "");
    }
  }, [open, mode, host]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [open]);

  const probe = async (targetHost: string) => {
    setProbing(true);
    setProbeErr(null);
    try {
      const base = hostToHttpBase(targetHost);
      const res = await fetch(`${base}/status?t=${Date.now()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as CarStatus;
      setStatus(j);
    } catch (e) {
      setStatus(null);
      setProbeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  };

  const label =
    wsState === "open"
      ? "Linked"
      : wsState === "connecting"
        ? "Connecting…"
        : wsState === "error"
          ? "Error"
          : "Not linked";

  return (
    <dialog
      ref={dialogRef}
      className="link-modal m-auto w-[min(92vw,28rem)] border border-white/15 bg-[#121416] p-0 text-white shadow-2xl"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <p className="font-[family-name:var(--font-display)] text-sm tracking-wider text-[var(--paint)]">
          LINK
        </p>
        <button
          type="button"
          onClick={onClose}
          className="border border-white/20 px-2 py-1 text-xs text-white/60 hover:bg-white/5"
        >
          Close
        </button>
      </div>

      <div className="flex gap-1 border-b border-white/10 px-3 pt-2">
        {(
          [
            ["hotspot", "Hotspot"],
            ["home", "Home Wi‑Fi"],
          ] as const
        ).map(([id, name]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-xs tracking-wide ${
              tab === id
                ? "border-b-2 border-[var(--paint)] text-[var(--paint)]"
                : "text-white/45 hover:text-white/70"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="flex max-h-[75dvh] flex-col gap-4 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-white/50">
            {label}
            {linked && mode === "hotspot" ? ` · ${AP_HOST}` : null}
            {linked && mode === "home" && host ? ` · ${host}` : null}
          </span>
          {linked && (
            <button
              type="button"
              onClick={onDisconnect}
              className="border border-white/20 px-2 py-1 text-[10px] text-white/50 hover:bg-white/5"
            >
              Disconnect
            </button>
          )}
        </div>

        <ToggleSwitch
          label="Debug"
          checked={debug}
          onChange={onDebugChange}
          hint="Extra status under the windscreen Link chip."
        />

        {tab === "hotspot" && (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] uppercase tracking-wider text-white/40">
              No Wi‑Fi zone — drive via car hotspot
            </p>
            <ol className="list-decimal space-y-2 pl-4 text-xs leading-relaxed text-white/75">
              <li>
                Join Wi‑Fi{" "}
                <code className="rounded bg-white/10 px-1 font-mono text-[11px]">
                  {AP_SSID}
                </code>{" "}
                /{" "}
                <code className="rounded bg-white/10 px-1 font-mono text-[11px]">
                  {AP_PASS}
                </code>
              </li>
              <li>Tap Connect — motors &amp; steering over WebSocket.</li>
              <li>
                Optional setup page:{" "}
                <a
                  className="text-[var(--paint)] underline"
                  href={`http://${AP_HOST}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  http://{AP_HOST}/
                </a>
              </li>
            </ol>

            <button
              type="button"
              onClick={() => {
                onConnectHotspot();
                void probe(AP_HOST);
              }}
              className="border border-[var(--paint)]/70 px-3 py-2 text-xs text-[var(--paint)] hover:bg-[var(--paint)]/10"
            >
              {linked && mode === "hotspot" ? "Reconnect hotspot" : "Connect hotspot"}
            </button>

            <button
              type="button"
              disabled={probing}
              onClick={() => void probe(AP_HOST)}
              className="border border-white/20 px-3 py-1.5 text-[11px] text-white/60 hover:bg-white/5 disabled:opacity-50"
            >
              {probing ? "Checking…" : "Ping car status"}
            </button>
          </div>
        )}

        {tab === "home" && (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] uppercase tracking-wider text-white/40">
              Same Wi‑Fi as the car
            </p>
            <p className="text-xs leading-relaxed text-white/70">
              First configure home Wi‑Fi on the car (join SoftAP → open{" "}
              <code className="rounded bg-white/10 px-1">http://{AP_HOST}/</code>
              ). Then put your phone back on that network and connect here.
            </p>

            <label className="flex flex-col gap-1 text-xs text-[var(--rim)]">
              Car host / IP
              <input
                value={homeHost}
                onChange={(e) => setHomeHost(e.target.value)}
                placeholder="192.168.x.x or rc-car.local"
                className="border border-white/15 bg-black/40 px-2 py-1.5 font-mono text-sm text-white outline-none focus:border-[var(--paint)]"
                autoComplete="off"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!homeHost.trim()}
                onClick={() => {
                  onConnectHome(homeHost.trim());
                  void probe(homeHost.trim());
                }}
                className="border border-[var(--paint)]/70 px-3 py-2 text-xs text-[var(--paint)] hover:bg-[var(--paint)]/10 disabled:opacity-50"
              >
                Connect home
              </button>
              <button
                type="button"
                disabled={probing || !homeHost.trim()}
                onClick={() => void probe(homeHost.trim())}
                className="border border-white/20 px-3 py-1.5 text-[11px] text-white/60 hover:bg-white/5 disabled:opacity-50"
              >
                Ping status
              </button>
            </div>

            <p className="text-[10px] text-white/40">
              WS target:{" "}
              <code className="font-mono">
                {homeHost.trim() ? hostToWsUrl(homeHost) : "—"}
              </code>
            </p>
          </div>
        )}

        {probeErr && (
          <p className="text-xs text-amber-300">
            Status unreachable: {probeErr}. Join the car network / same LAN, then
            retry.
          </p>
        )}

        {status && (
          <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-[10px] text-white/60">
            <p>
              mode={status.mode ?? "?"} home={String(status.home ?? false)}
              {status.ssid ? ` ssid=${status.ssid}` : ""}
            </p>
            <p>
              ap={status.apIp ?? "?"}
              {status.ip ? ` · lan=${status.ip}` : ""}
              {typeof status.batt === "number" ? ` · batt=${status.batt}%` : ""}
            </p>
          </div>
        )}
      </div>
    </dialog>
  );
}

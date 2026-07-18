"use client";

import { useEffect, useRef, useState } from "react";
import type { BleState } from "@/hooks/useBleProvision";
import type { WifiNetwork, WifiStatus } from "@/lib/ble";

type Props = {
  open: boolean;
  onClose: () => void;
  mounted: boolean;
  supported: boolean;
  bleState: BleState;
  error: string | null;
  controlError?: string | null;
  wifiStatus: WifiStatus | null;
  networks: WifiNetwork[];
  transport: "wifi" | "ble" | "none";
  debug: boolean;
  onDebugChange: (value: boolean) => void;
  lastAck?: string | null;
  onConnectBle: () => void;
  onScanWifi: () => Promise<void>;
  onProvisionWifi: (ssid: string, password: string) => Promise<void>;
  onForgetWifi: () => Promise<void>;
};

export function LinkSettingsModal({
  open,
  onClose,
  mounted,
  supported,
  bleState,
  error,
  controlError,
  wifiStatus,
  networks,
  transport,
  debug,
  onDebugChange,
  lastAck,
  onConnectBle,
  onScanWifi,
  onProvisionWifi,
  onForgetWifi,
}: Props) {
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const wifi = wifiStatus?.wifi ?? "disconnected";
  const bleOk = bleState === "connected";

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [open]);

  const submit = async () => {
    if (!ssid.trim()) return;
    setBusy(true);
    try {
      await onProvisionWifi(ssid.trim(), password);
    } finally {
      setBusy(false);
    }
  };

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
          LINK & DEBUG
        </p>
        <button
          type="button"
          onClick={onClose}
          className="border border-white/20 px-2 py-1 text-xs text-white/60 hover:bg-white/5"
        >
          Close
        </button>
      </div>

      <div className="flex max-h-[75dvh] flex-col gap-4 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {mounted && supported && (
            <button
              type="button"
              onClick={onConnectBle}
              disabled={bleState === "connecting"}
              className="border border-[var(--paint)]/70 px-3 py-1.5 text-xs text-[var(--paint)] hover:bg-[var(--paint)]/10 disabled:opacity-50"
            >
              {bleOk
                ? "Bluetooth OK"
                : bleState === "connecting"
                  ? "Pairing…"
                  : "Connect Bluetooth"}
            </button>
          )}
          <span className="font-mono text-[11px] text-white/50">
            {transport.toUpperCase()}
            {wifiStatus?.ip ? ` · ${wifiStatus.ip}` : ""}
          </span>
        </div>

        {mounted && !supported && (
          <p className="text-xs text-amber-300">
            Use Chrome/Edge on Android or Windows for Web Bluetooth.
          </p>
        )}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {controlError && (
          <p className="text-xs text-red-300">BLE control: {controlError}</p>
        )}

        {bleOk && (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] uppercase tracking-wider text-white/40">WiFi</p>
            {wifi !== "connected" && (
              <>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={wifi === "scanning" || wifi === "connecting"}
                    onClick={() => void onScanWifi()}
                    className="border border-white/25 px-3 py-1.5 text-xs text-white/80 hover:bg-white/5 disabled:opacity-50"
                  >
                    {wifi === "scanning" ? "Scanning…" : "Scan WiFi"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onForgetWifi()}
                    className="border border-white/15 px-3 py-1.5 text-xs text-white/50 hover:bg-white/5"
                  >
                    Forget saved
                  </button>
                </div>

                {networks.length > 0 && (
                  <label className="flex flex-col gap-1 text-xs text-[var(--rim)]">
                    Network
                    <select
                      value={ssid}
                      onChange={(e) => setSsid(e.target.value)}
                      className="border border-white/15 bg-black/40 px-2 py-1.5 font-mono text-sm text-white outline-none focus:border-[var(--paint)]"
                    >
                      <option value="">— select —</option>
                      {networks.map((n) => (
                        <option key={`${n.ssid}-${n.rssi}`} value={n.ssid}>
                          {n.ssid} ({n.rssi ?? "?"} dBm)
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1 text-xs text-[var(--rim)]">
                    SSID
                    <input
                      value={ssid}
                      onChange={(e) => setSsid(e.target.value)}
                      className="border border-white/15 bg-black/40 px-2 py-1.5 font-mono text-sm text-white outline-none focus:border-[var(--paint)]"
                      autoComplete="off"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--rim)]">
                    Password
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="border border-white/15 bg-black/40 px-2 py-1.5 font-mono text-sm text-white outline-none focus:border-[var(--paint)]"
                      autoComplete="off"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || !ssid.trim() || wifi === "connecting"}
                    onClick={() => void submit()}
                    className="border border-[var(--rim)] px-3 py-1.5 text-xs text-[var(--rim)] hover:bg-[var(--rim)]/10 disabled:opacity-50"
                  >
                    {wifi === "connecting" ? "Joining…" : "Join WiFi"}
                  </button>
                </div>
              </>
            )}

            {wifi === "connected" && (
              <p className="text-xs text-emerald-300">
                WiFi OK — preferred for control.
                {wifiStatus?.ws ? ` ${wifiStatus.ws}` : ""}
              </p>
            )}
            {wifi === "failed" && (
              <p className="text-xs text-red-300">
                WiFi failed{wifiStatus?.error ? `: ${wifiStatus.error}` : ""}.
                {wifiStatus?.error?.includes("ssid_not") &&
                  " ESP32 needs 2.4 GHz WiFi."}
              </p>
            )}
          </div>
        )}

        <div className="border-t border-white/10 pt-3">
          <label className="flex cursor-pointer items-center justify-between gap-2 text-xs text-white/70">
            <span>Debug overlays</span>
            <input
              type="checkbox"
              checked={debug}
              onChange={(e) => onDebugChange(e.target.checked)}
              className="accent-[var(--paint)]"
            />
          </label>
          {debug && (
            <p className="mt-2 font-mono text-[11px] text-white/45">
              link={transport} ack={lastAck ?? "—"}
            </p>
          )}
        </div>
      </div>
    </dialog>
  );
}

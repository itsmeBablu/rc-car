"use client";

import { useEffect, useRef, useState } from "react";
import { ToggleSwitch } from "@/components/ToggleSwitch";
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
  preferBle: boolean;
  onPreferBleChange: (value: boolean) => void;
  debug: boolean;
  onDebugChange: (value: boolean) => void;
  onConnectBle: () => void;
  onScanWifi: () => Promise<void>;
  onProvisionWifi: (ssid: string, password: string) => Promise<void>;
  onDisconnectWifi: () => Promise<void>;
  onForgetWifi: () => Promise<void>;
  initialSsid?: string;
  initialPassword?: string;
};

function WifiForm({
  wifi,
  networks,
  ssid,
  password,
  busy,
  wifiConnected,
  initialSsid,
  onSsid,
  onPassword,
  onScan,
  onSubmit,
  onForget,
}: {
  wifi: string;
  networks: WifiNetwork[];
  ssid: string;
  password: string;
  busy: boolean;
  wifiConnected: boolean;
  initialSsid: string;
  onSsid: (v: string) => void;
  onPassword: (v: string) => void;
  onScan: () => void;
  onSubmit: () => void;
  onForget: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={wifi === "scanning" || wifi === "connecting"}
          onClick={onScan}
          className="border border-white/25 px-3 py-1.5 text-xs text-white/80 hover:bg-white/5 disabled:opacity-50"
        >
          {wifi === "scanning" ? "Scanning…" : "Scan WiFi"}
        </button>
        {!wifiConnected && (
          <button
            type="button"
            onClick={onForget}
            className="border border-white/15 px-3 py-1.5 text-xs text-white/50 hover:bg-white/5"
          >
            Forget saved
          </button>
        )}
      </div>

      {networks.length > 0 && (
        <label className="flex flex-col gap-1 text-xs text-[var(--rim)]">
          Network
          <select
            value={ssid}
            onChange={(e) => onSsid(e.target.value)}
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
            onChange={(e) => onSsid(e.target.value)}
            className="border border-white/15 bg-black/40 px-2 py-1.5 font-mono text-sm text-white outline-none focus:border-[var(--paint)]"
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--rim)]">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => onPassword(e.target.value)}
            className="border border-white/15 bg-black/40 px-2 py-1.5 font-mono text-sm text-white outline-none focus:border-[var(--paint)]"
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          disabled={busy || !ssid.trim() || wifi === "connecting"}
          onClick={onSubmit}
          className="border border-[var(--rim)] px-3 py-1.5 text-xs text-[var(--rim)] hover:bg-[var(--rim)]/10 disabled:opacity-50"
        >
          {wifi === "connecting"
            ? "Joining…"
            : wifiConnected
              ? "Join other WiFi"
              : "Join WiFi"}
        </button>
        {initialSsid ? (
          <p className="text-[10px] text-white/35">
            {wifiConnected
              ? `Saved “${initialSsid}”.`
              : `Saved “${initialSsid}”. Optional — camera only. Drive works over Bluetooth with no WiFi.`}
          </p>
        ) : (
          <p className="text-[10px] text-white/35">
            WiFi is optional — for camera. Drive with Bluetooth only in no-WiFi zones.
          </p>
        )}
      </div>
    </>
  );
}

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
  preferBle,
  onPreferBleChange,
  debug,
  onDebugChange,
  onConnectBle,
  onScanWifi,
  onProvisionWifi,
  onDisconnectWifi,
  onForgetWifi,
  initialSsid = "",
  initialPassword = "",
}: Props) {
  const [ssid, setSsid] = useState(initialSsid);
  const [password, setPassword] = useState(initialPassword);
  const [busy, setBusy] = useState(false);
  const [changeNetwork, setChangeNetwork] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const wifi = wifiStatus?.wifi ?? "disconnected";
  const bleOk = bleState === "connected";
  const bleBusy = bleState === "connecting";
  const wifiConnected = wifi === "connected";
  const showWifiForm = bleOk && (!wifiConnected || changeNetwork);

  useEffect(() => {
    if (!open) return;
    if (initialSsid) setSsid((s) => s || initialSsid);
    if (initialPassword) setPassword((p) => p || initialPassword);
  }, [open, initialSsid, initialPassword]);

  useEffect(() => {
    if (!open) setChangeNetwork(false);
  }, [open]);

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
      setChangeNetwork(false);
    } finally {
      setBusy(false);
    }
  };

  const disconnectWifi = async () => {
    setBusy(true);
    try {
      await onDisconnectWifi();
      setChangeNetwork(true);
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

      <div className="flex max-h-[75dvh] flex-col gap-4 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {mounted && supported && (
            <button
              type="button"
              onClick={onConnectBle}
              disabled={bleBusy}
              className="border border-[var(--paint)]/70 px-3 py-1.5 text-xs text-[var(--paint)] hover:bg-[var(--paint)]/10 disabled:opacity-50"
            >
              {bleOk
                ? "Bluetooth OK"
                : bleBusy
                  ? "Pairing…"
                  : "Connect Bluetooth"}
            </button>
          )}
          <span className="font-mono text-[11px] text-white/50">
            {bleBusy
              ? "BLE…"
              : `${transport.toUpperCase()}${wifiStatus?.ip ? ` · ${wifiStatus.ip}` : ""}`}
          </span>
        </div>

        {(wifi === "connecting" || wifi === "scanning") && (
          <p className="rounded-lg border border-[var(--paint)]/25 bg-[var(--paint)]/5 px-3 py-2 text-[11px] text-[var(--paint)]/90">
            {wifi === "scanning"
              ? "Scanning WiFi…"
              : `Joining${wifiStatus?.ssid ? ` “${wifiStatus.ssid}”` : ""}…`}
          </p>
        )}

        <ToggleSwitch
          label="Controls via Bluetooth"
          checked={preferBle}
          onChange={onPreferBleChange}
          hint={
            preferBle
              ? "Drive servo + motors over BLE. Works with no WiFi. Join WiFi only for camera."
              : "Drive over WiFi WebSocket when linked; BLE is fallback."
          }
        />

        <ToggleSwitch
          label="Debug"
          checked={debug}
          onChange={onDebugChange}
          hint="Shows a small debug panel under Link (top right)."
        />

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

            {wifiConnected && (
              <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 px-3 py-2.5">
                <p className="text-xs text-emerald-300">
                  Connected
                  {wifiStatus?.ssid ? ` · ${wifiStatus.ssid}` : ""}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-white/45">
                  {wifiStatus?.ip ?? ""}
                  {preferBle ? " · camera" : " · camera + control"}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void disconnectWifi()}
                    className="border border-white/25 px-3 py-1.5 text-xs text-white/80 hover:bg-white/5 disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setChangeNetwork((v) => !v)}
                    className="border border-[var(--rim)]/50 px-3 py-1.5 text-xs text-[var(--rim)] hover:bg-[var(--rim)]/10 disabled:opacity-50"
                  >
                    {changeNetwork ? "Cancel" : "Change network"}
                  </button>
                </div>
              </div>
            )}

            {showWifiForm && (
              <WifiForm
                wifi={wifi}
                networks={networks}
                ssid={ssid}
                password={password}
                busy={busy}
                wifiConnected={wifiConnected}
                initialSsid={initialSsid}
                onSsid={setSsid}
                onPassword={setPassword}
                onScan={() => void onScanWifi()}
                onSubmit={() => void submit()}
                onForget={() => void onForgetWifi()}
              />
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
      </div>
    </dialog>
  );
}

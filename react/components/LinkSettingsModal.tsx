"use client";

import { useEffect, useRef, useState } from "react";
import { SignalBars } from "@/components/SignalBars";
import { ToggleSwitch } from "@/components/ToggleSwitch";
import type { ConnectionState } from "@/hooks/useCarSocket";
import {
  AP_HOST,
  AP_PASS,
  AP_SSID,
  forgetSavedNetwork,
  hostToHttpBase,
  hostToWsUrl,
  loadSavedNetworks,
  rssiToBars,
  type LinkMode,
  type SavedNetwork,
  upsertSavedNetwork,
} from "@/lib/protocol";

export type CarStatus = {
  mode?: string;
  apIp?: string;
  ip?: string;
  ssid?: string;
  savedSsid?: string;
  saved?: boolean;
  home?: boolean;
  homeState?: string;
  batt?: number;
  mv?: number;
  usb?: boolean;
  charging?: boolean;
  full?: boolean;
  ws?: string;
  wsHome?: string;
  rssi?: number;
  apRssi?: number;
  apClients?: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  mode: LinkMode;
  host: string;
  wsState: ConnectionState;
  linked: boolean;
  carStatus: CarStatus | null;
  signalBars: number;
  debug: boolean;
  onDebugChange: (v: boolean) => void;
  onConnectHotspot: () => void;
  onConnectHome: (host: string) => void;
  onDisconnect: () => void;
  onRefreshStatus: () => Promise<void>;
};

export function LinkSettingsModal({
  open,
  onClose,
  mode,
  host,
  wsState,
  linked,
  carStatus,
  signalBars,
  debug,
  onDebugChange,
  onConnectHotspot,
  onConnectHome,
  onDisconnect,
  onRefreshStatus,
}: Props) {
  const [tab, setTab] = useState<LinkMode>(mode);
  const [homeHost, setHomeHost] = useState(host || "");
  const [saved, setSaved] = useState<SavedNetwork[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [carSsid, setCarSsid] = useState("");
  const [carPass, setCarPass] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) {
      setTab(mode);
      setHomeHost(host || "");
      setSaved(loadSavedNetworks());
      setMsg(null);
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

  const statusLine =
    wsState === "open"
      ? mode === "hotspot"
        ? "Connected to hotspot"
        : "Connected to home Wi‑Fi"
      : wsState === "connecting"
        ? "Connecting…"
        : wsState === "error"
          ? "Connection error"
          : "Not linked";

  const tip =
    linked && mode === "hotspot"
      ? carStatus?.home && carStatus.ip
        ? `Hotspot linked. Car is also on “${carStatus.ssid || "home Wi‑Fi"}” @ ${carStatus.ip} — switch your phone to that network, then use Home Wi‑Fi.`
        : carStatus?.saved
          ? "Hotspot linked. Try Home Wi‑Fi next for camera & LAN — put your phone on the same router as the car."
          : "Hotspot linked. Save home Wi‑Fi on the car below (or open the setup page), then connect via Home Wi‑Fi."
      : linked && mode === "home"
        ? `Home Wi‑Fi linked${carStatus?.ssid ? ` · ${carStatus.ssid}` : ""}. Stay on this network for the best camera stream.`
        : null;

  const connectSelected = () => {
    const n = saved.find((s) => s.id === selectedId);
    if (!n) return;
    if (n.mode === "hotspot") onConnectHotspot();
    else {
      setHomeHost(n.host);
      onConnectHome(n.host);
    }
    setTab(n.mode);
  };

  const forgetSelected = () => {
    if (!selectedId) return;
    setSaved(forgetSavedNetwork(selectedId));
    setSelectedId(null);
    setMsg("Removed from this device.");
  };

  const forgetCarHome = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const base = hostToHttpBase(mode === "hotspot" ? AP_HOST : homeHost || host);
      const res = await fetch(`${base}/forget`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMsg("Car forgot home Wi‑Fi. SoftAP still available.");
      await onRefreshStatus();
    } catch (e) {
      setMsg(
        e instanceof Error
          ? `Forget failed: ${e.message}`
          : "Forget failed — join SoftAP first.",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveCarHomeWifi = async () => {
    if (!carSsid.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const body = new URLSearchParams({
        ssid: carSsid.trim(),
        pass: carPass,
      });
      const res = await fetch(`http://${AP_HOST}/wifi`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      upsertSavedNetwork({
        mode: "home",
        host: carStatus?.ip || homeHost || "rc-car.local",
        label: carSsid.trim(),
        ssid: carSsid.trim(),
      });
      setSaved(loadSavedNetworks());
      setMsg(
        "Saved on car. When it joins home Wi‑Fi, switch your phone to that network and Connect home.",
      );
      await onRefreshStatus();
    } catch (e) {
      setMsg(
        e instanceof Error
          ? `Save failed: ${e.message} — stay on ${AP_SSID}.`
          : "Save failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="link-modal m-auto w-[min(94vw,30rem)] border border-white/15 bg-[#121416] p-0 text-white shadow-2xl"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
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

      <div className="flex max-h-[78dvh] flex-col gap-3 overflow-y-auto px-4 py-3">
        {/* Live connection banner */}
        <div
          className={`rounded-xl border px-3 py-2.5 ${
            linked
              ? "border-emerald-400/30 bg-emerald-400/10"
              : "border-white/10 bg-black/30"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <p
              className={`text-xs font-medium ${
                linked ? "text-emerald-300" : "text-white/55"
              }`}
            >
              {statusLine}
            </p>
            <SignalBars
              bars={signalBars}
              label={
                linked
                  ? mode === "hotspot"
                    ? "Hotspot"
                    : "Wi‑Fi"
                  : "—"
              }
            />
          </div>
          {linked && (
            <p className="mt-1 font-mono text-[10px] text-white/45">
              {mode === "hotspot"
                ? `${AP_SSID} · ${AP_HOST}`
                : `${host || "home"}${carStatus?.ip ? ` · ${carStatus.ip}` : ""}`}
            </p>
          )}
          {tip && (
            <p className="mt-2 text-[11px] leading-relaxed text-emerald-200/90">
              {tip}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {linked ? (
            <button
              type="button"
              onClick={onDisconnect}
              className="border border-white/25 px-3 py-1.5 text-xs text-white/75 hover:bg-white/5"
            >
              Disconnect
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void onRefreshStatus()}
            className="border border-white/15 px-3 py-1.5 text-xs text-white/50 hover:bg-white/5 disabled:opacity-50"
          >
            Refresh status
          </button>
        </div>

        {/* Saved on this phone */}
        <div className="flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-wider text-white/40">
            Saved on this device
          </p>
          {saved.length === 0 ? (
            <p className="text-[11px] text-white/35">
              Connections you use are saved here for quick reconnect.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {saved.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(n.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs ${
                      selectedId === n.id
                        ? "border-[var(--paint)]/50 bg-[var(--paint)]/10"
                        : "border-white/10 bg-black/25 hover:bg-white/5"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-white/85">
                        {n.label}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-white/40">
                        {n.mode === "hotspot" ? "Hotspot" : "Home"} · {n.host}
                      </span>
                    </span>
                    {mode === n.mode &&
                    linked &&
                    (n.mode === "hotspot" ||
                      n.host.trim().toLowerCase() ===
                        host.trim().toLowerCase()) ? (
                      <span className="shrink-0 text-[10px] text-emerald-400">
                        Active
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!selectedId}
              onClick={connectSelected}
              className="border border-[var(--paint)]/60 px-3 py-1.5 text-xs text-[var(--paint)] hover:bg-[var(--paint)]/10 disabled:opacity-40"
            >
              Connect
            </button>
            <button
              type="button"
              disabled={!selectedId}
              onClick={forgetSelected}
              className="border border-white/15 px-3 py-1.5 text-xs text-white/50 hover:bg-white/5 disabled:opacity-40"
            >
              Forget
            </button>
          </div>
        </div>

        <div className="flex gap-1 border-b border-white/10">
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

        {tab === "hotspot" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed text-white/70">
              Off-grid drive: join{" "}
              <code className="rounded bg-white/10 px-1 font-mono text-[11px]">
                {AP_SSID}
              </code>{" "}
              /{" "}
              <code className="rounded bg-white/10 px-1 font-mono text-[11px]">
                {AP_PASS}
              </code>
              , then Connect.
            </p>
            <button
              type="button"
              onClick={onConnectHotspot}
              className="border border-[var(--paint)]/70 px-3 py-2 text-xs text-[var(--paint)] hover:bg-[var(--paint)]/10"
            >
              {linked && mode === "hotspot" ? "Reconnect hotspot" : "Connect hotspot"}
            </button>

            <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wider text-white/40">
                Save home Wi‑Fi on car
              </p>
              <p className="mt-1 text-[11px] text-white/50">
                Stay on the car hotspot. Credentials are stored on the ESP32.
              </p>
              <label className="mt-2 flex flex-col gap-1 text-[11px] text-white/45">
                SSID (2.4 GHz)
                <input
                  value={carSsid}
                  onChange={(e) => setCarSsid(e.target.value)}
                  className="border border-white/15 bg-black/40 px-2 py-1.5 font-mono text-sm text-white outline-none focus:border-[var(--paint)]"
                  autoComplete="off"
                />
              </label>
              <label className="mt-2 flex flex-col gap-1 text-[11px] text-white/45">
                Password
                <input
                  type="password"
                  value={carPass}
                  onChange={(e) => setCarPass(e.target.value)}
                  className="border border-white/15 bg-black/40 px-2 py-1.5 font-mono text-sm text-white outline-none focus:border-[var(--paint)]"
                  autoComplete="off"
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !carSsid.trim()}
                  onClick={() => void saveCarHomeWifi()}
                  className="border border-emerald-400/40 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-40"
                >
                  Save on car
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void forgetCarHome()}
                  className="border border-white/15 px-3 py-1.5 text-xs text-white/45 hover:bg-white/5 disabled:opacity-40"
                >
                  Forget on car
                </button>
              </div>
              <a
                className="mt-2 inline-block text-[10px] text-[var(--paint)] underline"
                href={`http://${AP_HOST}/`}
                target="_blank"
                rel="noreferrer"
              >
                Open car setup page
              </a>
            </div>
          </div>
        )}

        {tab === "home" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed text-white/70">
              Phone and car on the same router. Enter the car IP (from hotspot
              status) or{" "}
              <code className="rounded bg-white/10 px-1">rc-car.local</code>.
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
            {carStatus?.ip && mode !== "home" && (
              <button
                type="button"
                className="self-start text-[11px] text-emerald-300 underline"
                onClick={() => setHomeHost(carStatus.ip || "")}
              >
                Use car LAN IP {carStatus.ip}
              </button>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!homeHost.trim()}
                onClick={() => onConnectHome(homeHost.trim())}
                className="border border-[var(--paint)]/70 px-3 py-2 text-xs text-[var(--paint)] hover:bg-[var(--paint)]/10 disabled:opacity-50"
              >
                {linked && mode === "home" ? "Reconnect home" : "Connect home"}
              </button>
            </div>
            <p className="text-[10px] text-white/40">
              WS{" "}
              <code className="font-mono">
                {homeHost.trim() ? hostToWsUrl(homeHost) : "—"}
              </code>
            </p>
          </div>
        )}

        {msg && <p className="text-xs text-amber-200/90">{msg}</p>}

        <ToggleSwitch
          label="Debug"
          checked={debug}
          onChange={onDebugChange}
          hint="Extra status under the windscreen Link chip."
        />

        {carStatus && debug && (
          <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-[10px] text-white/55">
            <p>
              mode={carStatus.mode} home={String(carStatus.home)} apRssi=
              {carStatus.apRssi ?? "—"} rssi={carStatus.rssi ?? "—"}
            </p>
            <p>
              ap={carStatus.apIp}
              {carStatus.ip ? ` · lan=${carStatus.ip}` : ""}
              {carStatus.savedSsid ? ` · saved=${carStatus.savedSsid}` : ""}
            </p>
          </div>
        )}
      </div>
    </dialog>
  );
}

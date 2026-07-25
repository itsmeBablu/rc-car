"use client";

import {
  useEffect,
  useState,
  type ReactNode,
  type TransitionEvent,
} from "react";
import { Glass } from "@/components/Glass";
import { SignalBars } from "@/components/SignalBars";
import { ToggleSwitch } from "@/components/ToggleSwitch";
import type { ConnectionState } from "@/hooks/useCarSocket";
import {
  getNetworkKind,
  httpsBlocksLocalCar,
  isHttpsApp,
  networkKindLabel,
  openDeviceWifiSettings,
  probeCarHost,
  probeSoftAp,
  softApGuessLabel,
  type NetKind,
  type ProbeResult,
} from "@/lib/linkNetwork";
import {
  AP_HOST,
  AP_PASS,
  AP_SSID,
  forgetSavedNetwork,
  hostToWsUrl,
  loadSavedNetworks,
  type CarStatus,
  type LinkMode,
  type SavedNetwork,
  upsertSavedNetwork,
} from "@/lib/protocol";

export type { CarStatus };

type View = "guide" | "hotspot" | "home" | "saved" | "more";
type LogLine = { t: number; text: string; tone?: "ok" | "warn" | "err" | "info" };

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
  onCarStatus?: (s: CarStatus | null) => void;
};

function PrimaryBtn({
  children,
  onClick,
  disabled,
  tone = "paint",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "paint" | "ok" | "muted";
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200"
      : tone === "muted"
        ? "border-white/20 bg-white/5 text-white/75"
        : "border-[var(--paint)]/60 bg-[var(--paint)]/15 text-[var(--paint)]";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full rounded-2xl border px-4 py-3.5 text-sm font-medium tracking-wide disabled:opacity-45 ${cls}`}
    >
      {children}
    </button>
  );
}

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
  onCarStatus,
}: Props) {
  const [view, setView] = useState<View>("guide");
  const [homeHost, setHomeHost] = useState(host || "");
  const [saved, setSaved] = useState<SavedNetwork[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [carSsid, setCarSsid] = useState("");
  const [carPass, setCarPass] = useState("");
  const [netKind, setNetKind] = useState<NetKind>("unknown");
  const [https, setHttps] = useState(false);
  const [softProbe, setSoftProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [wifiHint, setWifiHint] = useState<string | null>(null);
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  const pushLog = (text: string, tone: LogLine["tone"] = "info") => {
    setLog((prev) => [{ t: Date.now(), text, tone }, ...prev].slice(0, 12));
  };

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setShown(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), 400);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setView("guide");
    setHomeHost(host || "");
    setSaved(loadSavedNetworks());
    setMsg(null);
    setHttps(isHttpsApp());
    setNetKind(getNetworkKind());
  }, [open, host]);

  useEffect(() => {
    if (!open) return;
    if (wsState === "connecting") pushLog("Connecting to car…", "info");
    if (wsState === "open") pushLog("Linked — you can drive", "ok");
    if (wsState === "error") pushLog("Link failed", "err");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsState, open]);

  const onPanelTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName !== "transform") return;
    if (!open) setMounted(false);
  };

  if (!mounted) return null;

  const runSoftProbe = async () => {
    setProbing(true);
    pushLog("Looking for car hotspot…", "info");
    const r = await probeSoftAp();
    setSoftProbe(r);
    if (r.ok && r.status) {
      onCarStatus?.(r.status);
      pushLog("Found the car", "ok");
    } else {
      pushLog(r.error || "Car not found yet", "err");
    }
    setProbing(false);
    return r;
  };

  const changeWifi = () => {
    const r = openDeviceWifiSettings();
    setWifiHint(r.hint);
    pushLog(r.hint, "info");
  };

  const connectHotspotFlow = async () => {
    setBusy(true);
    setMsg(null);
    pushLog("Starting hotspot link…", "info");
    if (httpsBlocksLocalCar()) {
      setMsg(
        "HTTPS can’t use SoftAP WebSocket. Open the car page, or use Home Wi‑Fi.",
      );
      pushLog("HTTPS blocks SoftAP WebSocket", "warn");
      setBusy(false);
      setView("guide");
      return;
    }
    const probe = softProbe?.ok ? softProbe : await runSoftProbe();
    if (!probe.ok) {
      setMsg("Car not found. Join Porsche_RC_Car first.");
      setBusy(false);
      return;
    }
    onConnectHotspot();
    pushLog("WebSocket connecting…", "info");
    setBusy(false);
  };

  const connectHomeFlow = async () => {
    const h = homeHost.trim();
    if (!h) return;
    setBusy(true);
    setMsg(null);
    pushLog(`Connecting home → ${h}`, "info");
    const probe = await probeCarHost(h);
    if (probe.ok && probe.status) {
      onCarStatus?.(probe.status);
      pushLog("Car answered on home network", "ok");
    } else {
      pushLog(probe.error || "Car not reachable on that IP", "warn");
    }
    onConnectHome(h);
    setBusy(false);
  };

  /** One clear “next action” for beginners */
  const next = (() => {
    if (linked) {
      return {
        title: "You’re linked",
        body: "Close this screen and drive. Use Disconnect only when you want to stop.",
        cta: "Done — go drive",
        action: onClose,
        tone: "ok" as const,
      };
    }
    if (netKind === "cellular") {
      return {
        title: "Turn on Wi‑Fi",
        body: "Your phone is on mobile data. The car only talks over Wi‑Fi.",
        cta: "Open Wi‑Fi settings",
        action: changeWifi,
        tone: "paint" as const,
      };
    }
    if (!softProbe?.ok) {
      return {
        title: "Join the car Wi‑Fi",
        body: `In phone Settings, connect to “${AP_SSID}” with password ${AP_PASS}. Then come back and tap Check.`,
        cta: "Open Wi‑Fi settings",
        action: changeWifi,
        tone: "paint" as const,
        secondary: {
          label: probing ? "Checking car…" : "I joined — check car",
          action: () => void runSoftProbe(),
        },
      };
    }
    if (https) {
      return {
        title: "Open the car’s own page",
        body: "This website is HTTPS, so the browser blocks SoftAP control here. On the car Wi‑Fi, open the car page instead.",
        cta: `Open http://${AP_HOST}/`,
        action: () => {
          window.open(`http://${AP_HOST}/`, "_blank", "noopener,noreferrer");
        },
        tone: "paint" as const,
      };
    }
    return {
      title: "Connect to the car",
      body: "Phone is on Wi‑Fi and the car SoftAP answered. Tap below to finish linking.",
      cta: busy ? "Connecting…" : "Connect hotspot",
      action: () => void connectHotspotFlow(),
      tone: "paint" as const,
    };
  })();

  const connectSelected = () => {
    const n = saved.find((s) => s.id === selectedId);
    if (!n) return;
    if (n.mode === "hotspot") void connectHotspotFlow();
    else {
      setHomeHost(n.host);
      onConnectHome(n.host);
      setView("home");
    }
  };

  return (
    <div
      className={`link-fs${shown ? " is-open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Link"
      onClick={onClose}
    >
      <div
        className="link-fs-shell"
        onClick={(e) => e.stopPropagation()}
        onTransitionEnd={onPanelTransitionEnd}
      >
        <Glass borderRadius={0} zIndex={2} className="h-full w-full">
          <div className="link-fs-inner">
        {/* Header */}
        <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">
              GT2 RS
            </p>
            <h1 className="font-[family-name:var(--font-display)] text-2xl tracking-[0.12em] text-[var(--paint)]">
              LINK
            </h1>
            <p className="mt-1 flex items-center gap-2 text-xs text-white/50">
              <SignalBars bars={signalBars} compact />
              {linked
                ? mode === "hotspot"
                  ? "Hotspot"
                  : "Home Wi‑Fi"
                : wsState === "connecting"
                  ? "Connecting…"
                  : "Not linked"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5"
          >
            Close
          </button>
        </header>

        {/* Nav */}
        <nav className="flex gap-1 overflow-x-auto border-b border-white/10 px-3 sm:px-6">
          {(
            [
              ["guide", "Start"],
              ["hotspot", "Away"],
              ["home", "Home"],
              ["saved", "Saved"],
              ["more", "More"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={`shrink-0 px-3 py-2.5 text-xs tracking-wide ${
                view === id
                  ? "border-b-2 border-[var(--paint)] text-[var(--paint)]"
                  : "text-white/40 hover:text-white/65"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {view === "guide" && (
            <div className="mx-auto flex max-w-lg flex-col gap-5">
              <section className="rounded-3xl border border-white/12 bg-white/[0.04] p-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                  What to do next
                </p>
                <h2 className="mt-2 font-[family-name:var(--font-display)] text-xl tracking-wide text-white">
                  {next.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/60">
                  {next.body}
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <PrimaryBtn
                    tone={next.tone}
                    disabled={busy || probing}
                    onClick={next.action}
                  >
                    {next.cta}
                  </PrimaryBtn>
                  {"secondary" in next && next.secondary ? (
                    <PrimaryBtn
                      tone="muted"
                      disabled={busy || probing}
                      onClick={next.secondary.action}
                    >
                      {next.secondary.label}
                    </PrimaryBtn>
                  ) : null}
                </div>
                {wifiHint && (
                  <p className="mt-3 text-xs text-amber-200/90">{wifiHint}</p>
                )}
                {msg && <p className="mt-3 text-xs text-amber-200/90">{msg}</p>}
              </section>

              <section className="rounded-3xl border border-white/10 bg-black/25 p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                  How linking works
                </p>
                <ol className="mt-3 space-y-3 text-sm text-white/70">
                  <li className="flex gap-3">
                    <span className="font-mono text-[var(--paint)]">1</span>
                    <span>
                      Put your phone on the <strong className="text-white/90">car Wi‑Fi</strong>{" "}
                      (away from home) or your <strong className="text-white/90">home Wi‑Fi</strong>{" "}
                      (same as the car).
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-mono text-[var(--paint)]">2</span>
                    <span>
                      Check that this app can see the car, then tap Connect.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-mono text-[var(--paint)]">3</span>
                    <span>
                      When the status says linked, close this screen and drive.
                    </span>
                  </li>
                </ol>
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setView("hotspot")}
                  className="rounded-2xl border border-white/12 bg-white/[0.03] p-4 text-left hover:bg-white/[0.06]"
                >
                  <p className="text-[10px] uppercase tracking-wider text-white/40">
                    Away from home
                  </p>
                  <p className="mt-1 text-sm text-white/90">Car hotspot</p>
                  <p className="mt-1 text-xs text-white/45">
                    Join {AP_SSID} on your phone
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setView("home")}
                  className="rounded-2xl border border-white/12 bg-white/[0.03] p-4 text-left hover:bg-white/[0.06]"
                >
                  <p className="text-[10px] uppercase tracking-wider text-white/40">
                    At home
                  </p>
                  <p className="mt-1 text-sm text-white/90">Same Wi‑Fi</p>
                  <p className="mt-1 text-xs text-white/45">
                    Phone + car on your router
                  </p>
                </button>
              </section>

              <section className="rounded-2xl border border-white/10 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-white/40">
                  Right now
                </p>
                <ul className="mt-2 space-y-1.5 text-xs text-white/55">
                  <li>
                    Phone network:{" "}
                    <span className="text-white/80">
                      {networkKindLabel(netKind)}
                    </span>
                  </li>
                  <li>{softApGuessLabel(softProbe)}</li>
                  <li>
                    Link:{" "}
                    <span className="text-white/80">
                      {linked
                        ? "connected"
                        : wsState === "connecting"
                          ? "connecting…"
                          : "not connected"}
                    </span>
                  </li>
                  {https && (
                    <li className="text-amber-200/90">
                      App is HTTPS — SoftAP drive needs the car page or Home Wi‑Fi
                    </li>
                  )}
                </ul>
              </section>

              {log.length > 0 && (
                <section className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-white/35">
                    Activity
                  </p>
                  <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto font-mono text-[10px]">
                    {log.map((l) => (
                      <li
                        key={l.t + l.text}
                        className={
                          l.tone === "ok"
                            ? "text-emerald-300/90"
                            : l.tone === "err"
                              ? "text-red-300/90"
                              : l.tone === "warn"
                                ? "text-amber-200/90"
                                : "text-white/45"
                        }
                      >
                        {l.text}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {linked && (
                <PrimaryBtn
                  tone="muted"
                  onClick={() => {
                    onDisconnect();
                    pushLog("Disconnected", "warn");
                  }}
                >
                  Disconnect
                </PrimaryBtn>
              )}
            </div>
          )}

          {view === "hotspot" && (
            <div className="mx-auto flex max-w-lg flex-col gap-5">
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-lg tracking-wide text-white">
                  Drive away from home
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/60">
                  Your phone connects directly to the car’s Wi‑Fi. No home router
                  needed.
                </p>
              </div>

              <ol className="space-y-4">
                <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--paint)]">
                    Step 1
                  </p>
                  <p className="mt-1 text-sm text-white/90">
                    Join Wi‑Fi{" "}
                    <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[12px]">
                      {AP_SSID}
                    </code>
                  </p>
                  <p className="mt-1 text-xs text-white/45">
                    Password{" "}
                    <code className="font-mono text-white/70">{AP_PASS}</code>
                  </p>
                  <div className="mt-3">
                    <PrimaryBtn onClick={changeWifi}>Open Wi‑Fi settings</PrimaryBtn>
                  </div>
                </li>
                <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--paint)]">
                    Step 2
                  </p>
                  <p className="mt-1 text-sm text-white/90">
                    Make sure the car answers
                  </p>
                  <p className="mt-1 text-xs text-white/45">
                    {softApGuessLabel(softProbe)}
                  </p>
                  <div className="mt-3">
                    <PrimaryBtn
                      tone="muted"
                      disabled={probing}
                      onClick={() => void runSoftProbe()}
                    >
                      {probing ? "Checking…" : "Check car"}
                    </PrimaryBtn>
                  </div>
                </li>
                <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--paint)]">
                    Step 3
                  </p>
                  <p className="mt-1 text-sm text-white/90">Finish the link</p>
                  {https ? (
                    <>
                      <p className="mt-1 text-xs leading-relaxed text-amber-200/90">
                        This app is HTTPS, so SoftAP WebSocket is blocked. Open
                        the car’s page while you’re on {AP_SSID}.
                      </p>
                      <div className="mt-3">
                        <a
                          href={`http://${AP_HOST}/`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex w-full items-center justify-center rounded-2xl border border-amber-300/40 bg-amber-400/10 px-4 py-3.5 text-sm text-amber-100"
                        >
                          Open car page
                        </a>
                      </div>
                    </>
                  ) : (
                    <div className="mt-3">
                      <PrimaryBtn
                        disabled={busy}
                        onClick={() => void connectHotspotFlow()}
                      >
                        {busy
                          ? "Connecting…"
                          : linked && mode === "hotspot"
                            ? "Reconnect"
                            : "Connect hotspot"}
                      </PrimaryBtn>
                    </div>
                  )}
                </li>
              </ol>

              <details className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <summary className="cursor-pointer text-xs text-white/50">
                  Optional: save home Wi‑Fi on the car
                </summary>
                <p className="mt-2 text-xs text-white/45">
                  Stay on {AP_SSID}. The car will remember your router for later.
                </p>
                <label className="mt-3 flex flex-col gap-1 text-[11px] text-white/45">
                  Home SSID (2.4 GHz)
                  <input
                    value={carSsid}
                    onChange={(e) => setCarSsid(e.target.value)}
                    className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-[var(--paint)]"
                  />
                </label>
                <label className="mt-2 flex flex-col gap-1 text-[11px] text-white/45">
                  Password
                  <input
                    type="password"
                    value={carPass}
                    onChange={(e) => setCarPass(e.target.value)}
                    className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-[var(--paint)]"
                  />
                </label>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy || !carSsid.trim()}
                    onClick={() => void (async () => {
                      setBusy(true);
                      try {
                        const body = new URLSearchParams({
                          ssid: carSsid.trim(),
                          pass: carPass,
                        });
                        const res = await fetch(`http://${AP_HOST}/wifi`, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/x-www-form-urlencoded",
                          },
                          body,
                          signal: AbortSignal.timeout(8000),
                        });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        upsertSavedNetwork({
                          mode: "home",
                          host: carStatus?.ip || "rc-car.local",
                          label: carSsid.trim(),
                          ssid: carSsid.trim(),
                        });
                        setSaved(loadSavedNetworks());
                        setMsg("Saved on car.");
                        pushLog("Home Wi‑Fi saved on car", "ok");
                      } catch (e) {
                        setMsg(
                          e instanceof Error ? e.message : "Save failed",
                        );
                      } finally {
                        setBusy(false);
                      }
                    })()}
                    className="rounded-xl border border-emerald-400/40 px-3 py-2 text-xs text-emerald-300 disabled:opacity-40"
                  >
                    Save on car
                  </button>
                </div>
              </details>
              {msg && <p className="text-xs text-amber-200/90">{msg}</p>}
            </div>
          )}

          {view === "home" && (
            <div className="mx-auto flex max-w-lg flex-col gap-5">
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-lg tracking-wide text-white">
                  Drive at home
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/60">
                  Phone and car on the <strong className="text-white/85">same</strong>{" "}
                  home Wi‑Fi. Best for camera.
                </p>
              </div>

              <ol className="space-y-4">
                <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--paint)]">
                    Step 1
                  </p>
                  <p className="mt-1 text-sm text-white/90">
                    Teach the car your home Wi‑Fi once
                  </p>
                  <p className="mt-1 text-xs text-white/45">
                    Join {AP_SSID}, open the car page, enter your router name &amp;
                    password. Then switch your phone back to home Wi‑Fi.
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    <PrimaryBtn tone="muted" onClick={changeWifi}>
                      Open Wi‑Fi settings
                    </PrimaryBtn>
                    <a
                      href={`http://${AP_HOST}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex w-full items-center justify-center rounded-2xl border border-white/20 px-4 py-3 text-sm text-white/70"
                    >
                      Open car setup page
                    </a>
                  </div>
                </li>
                <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--paint)]">
                    Step 2
                  </p>
                  <p className="mt-1 text-sm text-white/90">Enter the car’s address</p>
                  <label className="mt-3 flex flex-col gap-1 text-xs text-white/45">
                    Car IP or name
                    <input
                      value={homeHost}
                      onChange={(e) => setHomeHost(e.target.value)}
                      placeholder="192.168.x.x or rc-car.local"
                      className="rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-[var(--paint)]"
                    />
                  </label>
                  {carStatus?.ip && (
                    <button
                      type="button"
                      className="mt-2 text-left text-xs text-emerald-300 underline"
                      onClick={() => setHomeHost(carStatus.ip || "")}
                    >
                      Use {carStatus.ip}
                    </button>
                  )}
                </li>
                <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--paint)]">
                    Step 3
                  </p>
                  <p className="mt-1 text-sm text-white/90">Connect</p>
                  <p className="mt-1 font-mono text-[10px] text-white/40">
                    {homeHost.trim() ? hostToWsUrl(homeHost) : "—"}
                  </p>
                  <div className="mt-3">
                    <PrimaryBtn
                      disabled={busy || !homeHost.trim()}
                      onClick={() => void connectHomeFlow()}
                    >
                      {busy
                        ? "Connecting…"
                        : linked && mode === "home"
                          ? "Reconnect"
                          : "Connect home"}
                    </PrimaryBtn>
                  </div>
                </li>
              </ol>
              {https && (
                <p className="text-xs text-amber-200/85">
                  Note: HTTPS sites often block local WebSockets. If Connect fails,
                  try local HTTP dev or the SoftAP car page.
                </p>
              )}
              {msg && <p className="text-xs text-amber-200/90">{msg}</p>}
            </div>
          )}

          {view === "saved" && (
            <div className="mx-auto flex max-w-lg flex-col gap-4">
              <h2 className="font-[family-name:var(--font-display)] text-lg tracking-wide text-white">
                Saved on this phone
              </h2>
              <p className="text-sm text-white/55">
                Pick one, then Connect. Forget removes it only from this device.
              </p>
              {saved.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/40">
                  Nothing saved yet. After you link once, it shows up here.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {saved.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(n.id)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left ${
                          selectedId === n.id
                            ? "border-[var(--paint)]/50 bg-[var(--paint)]/10"
                            : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <p className="text-sm text-white/90">{n.label}</p>
                        <p className="font-mono text-[10px] text-white/40">
                          {n.mode === "hotspot" ? "Hotspot" : "Home"} · {n.host}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <PrimaryBtn disabled={!selectedId || busy} onClick={connectSelected}>
                  Connect
                </PrimaryBtn>
              </div>
              <button
                type="button"
                disabled={!selectedId}
                onClick={() => {
                  if (!selectedId) return;
                  setSaved(forgetSavedNetwork(selectedId));
                  setSelectedId(null);
                }}
                className="text-xs text-white/40 underline disabled:opacity-40"
              >
                Forget selected
              </button>
            </div>
          )}

          {view === "more" && (
            <div className="mx-auto flex max-w-lg flex-col gap-5">
              <h2 className="font-[family-name:var(--font-display)] text-lg tracking-wide text-white">
                More
              </h2>
              <PrimaryBtn tone="muted" onClick={() => void onRefreshStatus()}>
                Refresh car status
              </PrimaryBtn>
              {linked && (
                <PrimaryBtn
                  tone="muted"
                  onClick={() => {
                    onDisconnect();
                    pushLog("Disconnected", "warn");
                  }}
                >
                  Disconnect
                </PrimaryBtn>
              )}
              <button
                type="button"
                onClick={() => void (async () => {
                  try {
                    await fetch(`http://${AP_HOST}/forget`, {
                      method: "POST",
                      signal: AbortSignal.timeout(5000),
                    });
                    setMsg("Car forgot home Wi‑Fi.");
                  } catch {
                    setMsg("Couldn’t reach car SoftAP to forget.");
                  }
                })()}
                className="text-left text-xs text-white/45 underline"
              >
                Forget home Wi‑Fi on the car
              </button>
              <ToggleSwitch
                label="Debug"
                checked={debug}
                onChange={onDebugChange}
                hint="Shows extra numbers on the cockpit."
              />
              {msg && <p className="text-xs text-amber-200/90">{msg}</p>}
              {carStatus && debug && (
                <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[10px] text-white/50">
                  {JSON.stringify(carStatus, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
          </div>
        </Glass>
      </div>
    </div>
  );
}

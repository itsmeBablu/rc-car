"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type TransitionEvent,
} from "react";
import { Glass } from "@/components/Glass";
import { SignalBars } from "@/components/SignalBars";
import { ToggleSwitch } from "@/components/ToggleSwitch";
import type { ConnectionState } from "@/hooks/useCarSocket";
import {
  buildLinkDebugReport,
  getNetworkKind,
  httpsBlocksLocalCar,
  isHttpsApp,
  isStandalonePwa,
  networkKindLabel,
  openCarSoftApPage,
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

type View = "guide" | "away" | "home" | "debug";
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
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [carSsid, setCarSsid] = useState("");
  const [carPass, setCarPass] = useState("");
  const [netKind, setNetKind] = useState<NetKind>("unknown");
  const [https, setHttps] = useState(false);
  const [pwa, setPwa] = useState(false);
  const [softProbe, setSoftProbe] = useState<ProbeResult | null>(null);
  const [homeProbe, setHomeProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [wifiHint, setWifiHint] = useState<string | null>(null);
  const [debugText, setDebugText] = useState("");
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [geom, setGeom] = useState<CSSProperties>({});
  const shellRef = useRef<HTMLDivElement>(null);

  const pushLog = (text: string, tone: LogLine["tone"] = "info") => {
    setLog((prev) => [{ t: Date.now(), text, tone }, ...prev].slice(0, 16));
  };

  const readAnchor = (): DOMRect | null => {
    const el = document.querySelector("[data-link-anchor]");
    if (!el) return null;
    return el.getBoundingClientRect();
  };

  const endGeom = (): CSSProperties => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const narrow = vw <= 720;
    const width = narrow ? Math.min(vw * 0.92, 22 * 16) : vw * 0.5;
    return {
      ["--link-t" as string]: "0px",
      ["--link-l" as string]: `${vw - width}px`,
      ["--link-w" as string]: `${width}px`,
      ["--link-h" as string]: `${vh}px`,
      ["--link-r" as string]: "0px",
    };
  };

  const originGeom = (r: DOMRect): CSSProperties => ({
    ["--link-t" as string]: `${r.top}px`,
    ["--link-l" as string]: `${r.left}px`,
    ["--link-w" as string]: `${r.width}px`,
    ["--link-h" as string]: `${r.height}px`,
    ["--link-r" as string]: "999px",
  });

  useEffect(() => {
    if (open) {
      const anchor = readAnchor();
      setGeom(anchor ? originGeom(anchor) : endGeom());
      setMounted(true);
      setShown(false);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Force layout so the browser interpolates from the button rect
          void shellRef.current?.offsetWidth;
          setGeom(endGeom());
          setShown(true);
        });
      });
      return () => cancelAnimationFrame(id);
    }

    const anchor = readAnchor();
    if (anchor) setGeom(originGeom(anchor));
    else setGeom(endGeom());
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), 520);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setView("guide");
    setHomeHost(host || "");
    setSaved(loadSavedNetworks());
    setMsg(null);
    setHttps(isHttpsApp());
    setPwa(isStandalonePwa());
    setNetKind(getNetworkKind());
    void (async () => {
      setProbing(true);
      const r = await probeSoftAp();
      setSoftProbe(r);
      if (r.ok && r.status) onCarStatus?.(r.status);
      setProbing(false);
    })();
  }, [open, host, onCarStatus]);

  useEffect(() => {
    if (!open) return;
    if (wsState === "connecting") pushLog("WebSocket connecting…", "info");
    if (wsState === "open") pushLog("Linked — you can drive", "ok");
    if (wsState === "error") pushLog("WebSocket error", "err");
    if (wsState === "closed") pushLog("WebSocket closed", "warn");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsState, open]);

  const onPanelTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (!["width", "left", "top", "height"].includes(e.propertyName)) return;
    if (!open) setMounted(false);
  };

  if (!mounted) return null;

  const blocked = httpsBlocksLocalCar();

  const runSoftProbe = async () => {
    setProbing(true);
    pushLog("Probe SoftAP 192.168.4.1/status…", "info");
    const r = await probeSoftAp();
    setSoftProbe(r);
    if (r.ok && r.status) {
      onCarStatus?.(r.status);
      pushLog(`SoftAP OK ${r.ms}ms home=${r.status.home} ip=${r.status.ip || "—"}`, "ok");
    } else {
      pushLog(r.error || "SoftAP probe failed", "err");
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
    pushLog("Hotspot connect…", "info");
    if (httpsBlocksLocalCar()) {
      setMsg(
        "HTTPS / Home Screen app cannot talk to the car. Open the car page on SoftAP instead.",
      );
      pushLog("Blocked: HTTPS mixed content / PWA", "err");
      setBusy(false);
      setView("away");
      return;
    }
    const probe = softProbe?.ok ? softProbe : await runSoftProbe();
    if (!probe.ok) {
      setMsg(`Join Wi‑Fi “${AP_SSID}” first, then Check again.`);
      setBusy(false);
      return;
    }
    onConnectHotspot();
    pushLog("WS → ws://192.168.4.1:81", "info");
    setBusy(false);
  };

  const connectHomeFlow = async () => {
    const h = homeHost.trim();
    if (!h) return;
    setBusy(true);
    setMsg(null);

    if (httpsBlocksLocalCar()) {
      setMsg(
        "HTTPS / Home Screen app blocks home LAN WebSockets too. Use http://localhost:3000 or the car SoftAP page.",
      );
      pushLog("Home blocked by HTTPS/PWA", "err");
      setBusy(false);
      return;
    }

    pushLog(`Probe home → ${h}`, "info");
    const probe = await probeCarHost(h, 5000);
    setHomeProbe(probe);
    if (!probe.ok) {
      setMsg(
        "Car not on that address. Save home Wi‑Fi on the car (via SoftAP page), wait until status shows home:true, then enter the car’s LAN IP.",
      );
      pushLog(probe.error || "Home probe failed", "err");
      setBusy(false);
      return;
    }

    const staIp = probe.status?.ip?.trim();
    const connectHost = staIp && staIp !== "0.0.0.0" ? staIp : h;
    if (staIp) setHomeHost(staIp);
    onCarStatus?.(probe.status ?? null);
    onConnectHome(connectHost);
    pushLog(`WS → ${hostToWsUrl(connectHost)}`, "info");
    setBusy(false);
  };

  const refreshDebug = () => {
    const report = buildLinkDebugReport({
      at: new Date().toISOString(),
      page: typeof window !== "undefined" ? window.location.href : "",
      https,
      standalonePwa: pwa,
      httpsBlocksLocal: httpsBlocksLocalCar(),
      netKind,
      wsState,
      linkMode: mode,
      host,
      softProbe,
      homeProbe,
      carStatus,
      log: log.map((l) => `${new Date(l.t).toISOString()} [${l.tone}] ${l.text}`),
      tip: blocked
        ? `Open http://${AP_HOST}/ while on SoftAP — Home Screen HTTPS cannot control the car.`
        : "SoftAP + home STA run together. Home needs saved SSID and a reachable LAN IP.",
    });
    setDebugText(report);
    return report;
  };

  const copyDebug = async () => {
    const report = refreshDebug();
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      pushLog("Debug copied to clipboard", "ok");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg("Copy failed — select the text manually.");
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
        ref={shellRef}
        className="link-fs-shell"
        style={geom}
        onClick={(e) => e.stopPropagation()}
        onTransitionEnd={onPanelTransitionEnd}
      >
        <Glass borderRadius={0} zIndex={2} className="h-full w-full">
          <div className="link-fs-inner">
            <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
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

            <nav className="flex gap-1 overflow-x-auto border-b border-white/10 px-3 sm:px-5">
              {(
                [
                  ["guide", "Start"],
                  ["away", "Away"],
                  ["home", "Home"],
                  ["debug", "Debug"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setView(id);
                    if (id === "debug") refreshDebug();
                  }}
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

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {blocked && (
                <div className="mb-4 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                  <p className="font-medium">
                    {pwa ? "Home Screen app" : "HTTPS page"} can’t reach the car
                  </p>
                  <p className="mt-1 text-xs text-amber-100/75">
                    Browsers block local <code className="text-amber-50">ws://</code> /{" "}
                    <code className="text-amber-50">http://</code> from HTTPS. Join{" "}
                    <strong>{AP_SSID}</strong>, then open the car’s own page.
                  </p>
                  <div className="mt-3">
                    <PrimaryBtn
                      onClick={() => {
                        pushLog("Opening SoftAP car page", "info");
                        openCarSoftApPage();
                      }}
                    >
                      Open car page · http://{AP_HOST}/
                    </PrimaryBtn>
                  </div>
                </div>
              )}

              {view === "guide" && (
                <div className="flex flex-col gap-4">
                  {linked ? (
                    <section className="rounded-3xl border border-emerald-400/35 bg-emerald-400/10 p-4">
                      <p className="text-sm text-emerald-100">You’re linked. Close and drive.</p>
                      <div className="mt-3 flex flex-col gap-2">
                        <PrimaryBtn tone="ok" onClick={onClose}>
                          Done — go drive
                        </PrimaryBtn>
                        <PrimaryBtn tone="muted" onClick={onDisconnect}>
                          Disconnect
                        </PrimaryBtn>
                      </div>
                    </section>
                  ) : (
                    <>
                      <section className="rounded-3xl border border-white/12 bg-white/[0.04] p-4">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">
                          Easy setup
                        </p>
                        <p className="mt-2 text-sm text-white/75">
                          Pick one path. SoftAP always stays on the car.
                        </p>
                        <div className="mt-4 grid gap-3">
                          <button
                            type="button"
                            onClick={() => setView("away")}
                            className="rounded-2xl border border-[var(--paint)]/35 bg-[var(--paint)]/10 p-4 text-left"
                          >
                            <p className="text-sm text-[var(--paint)]">Away · car hotspot</p>
                            <p className="mt-1 text-xs text-white/50">
                              Join {AP_SSID} / {AP_PASS}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => setView("home")}
                            className="rounded-2xl border border-white/12 bg-white/[0.03] p-4 text-left"
                          >
                            <p className="text-sm text-white/90">Home · same Wi‑Fi</p>
                            <p className="mt-1 text-xs text-white/50">
                              Save router on car, then connect by LAN IP
                            </p>
                          </button>
                        </div>
                      </section>

                      <section className="rounded-2xl border border-white/10 px-4 py-3 text-xs text-white/55">
                        <p>
                          Phone:{" "}
                          <span className="text-white/80">{networkKindLabel(netKind)}</span>
                        </p>
                        <p className="mt-1">{softApGuessLabel(softProbe)}</p>
                        <p className="mt-1">
                          WS: <span className="text-white/80">{wsState}</span>
                          {probing ? " · probing…" : ""}
                        </p>
                      </section>
                    </>
                  )}
                  {msg && <p className="text-xs text-amber-200/90">{msg}</p>}
                </div>
              )}

              {view === "away" && (
                <div className="flex flex-col gap-4">
                  <div>
                    <h2 className="font-[family-name:var(--font-display)] text-lg tracking-wide">
                      Away
                    </h2>
                    <p className="mt-1 text-sm text-white/55">
                      Phone joins the car hotspot. Best when you’re not on home Wi‑Fi.
                    </p>
                  </div>
                  <ol className="space-y-3 text-sm text-white/70">
                    <li className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--paint)]">
                        1 · Join Wi‑Fi
                      </p>
                      <p className="mt-1 font-mono text-xs text-white/85">
                        {AP_SSID} · {AP_PASS}
                      </p>
                      <div className="mt-3">
                        <PrimaryBtn tone="muted" onClick={changeWifi}>
                          Open Wi‑Fi settings
                        </PrimaryBtn>
                      </div>
                    </li>
                    <li className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--paint)]">
                        2 · Check car
                      </p>
                      <p className="mt-1 text-xs text-white/50">{softApGuessLabel(softProbe)}</p>
                      <div className="mt-3">
                        <PrimaryBtn
                          tone="muted"
                          disabled={probing}
                          onClick={() => void runSoftProbe()}
                        >
                          {probing ? "Checking…" : "Check SoftAP"}
                        </PrimaryBtn>
                      </div>
                    </li>
                    <li className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--paint)]">
                        3 · Connect
                      </p>
                      {blocked ? (
                        <div className="mt-3">
                          <PrimaryBtn onClick={openCarSoftApPage}>
                            Open http://{AP_HOST}/
                          </PrimaryBtn>
                        </div>
                      ) : (
                        <div className="mt-3">
                          <PrimaryBtn
                            disabled={busy || !softProbe?.ok}
                            onClick={() => void connectHotspotFlow()}
                          >
                            {busy ? "Connecting…" : "Connect hotspot"}
                          </PrimaryBtn>
                        </div>
                      )}
                    </li>
                  </ol>
                  {wifiHint && <p className="text-xs text-amber-200/90">{wifiHint}</p>}
                  {msg && <p className="text-xs text-amber-200/90">{msg}</p>}
                </div>
              )}

              {view === "home" && (
                <div className="flex flex-col gap-4">
                  <div>
                    <h2 className="font-[family-name:var(--font-display)] text-lg tracking-wide">
                      Home
                    </h2>
                    <p className="mt-1 text-sm text-white/55">
                      SoftAP stays up. Home STA joins your router in parallel (no longer paused).
                    </p>
                  </div>

                  <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--paint)]">
                      1 · Teach car (once)
                    </p>
                    <p className="mt-1 text-xs text-white/50">
                      Join SoftAP, open car page, or save here:
                    </p>
                    <div className="mt-3 flex flex-col gap-2">
                      <input
                        value={carSsid}
                        onChange={(e) => setCarSsid(e.target.value)}
                        placeholder="Home SSID (2.4 GHz)"
                        className="rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-[var(--paint)]"
                      />
                      <input
                        value={carPass}
                        onChange={(e) => setCarPass(e.target.value)}
                        type="password"
                        placeholder="Password"
                        className="rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-[var(--paint)]"
                      />
                      <PrimaryBtn
                        tone="muted"
                        disabled={!carSsid.trim() || busy}
                        onClick={() =>
                          void (async () => {
                            setBusy(true);
                            try {
                              const body = new URLSearchParams({
                                ssid: carSsid.trim(),
                                pass: carPass,
                              });
                              const res = await fetch(`http://${AP_HOST}/wifi`, {
                                method: "POST",
                                body,
                                mode: "cors",
                              });
                              if (!res.ok) throw new Error(`HTTP ${res.status}`);
                              pushLog("Home Wi‑Fi saved on car — STA joining…", "ok");
                              setMsg("Saved on car. Wait ~15s, then Check SoftAP for home:true + ip.");
                              setTimeout(() => void runSoftProbe(), 4000);
                            } catch (e) {
                              const err = e instanceof Error ? e.message : String(e);
                              pushLog(`Save failed: ${err}`, "err");
                              setMsg(
                                blocked
                                  ? "Can’t POST from HTTPS — open http://192.168.4.1/ and save there."
                                  : "Join SoftAP first, then save.",
                              );
                            }
                            setBusy(false);
                          })()
                        }
                      >
                        Save home Wi‑Fi on car
                      </PrimaryBtn>
                      <a
                        href={`http://${AP_HOST}/`}
                        className="text-center text-xs text-white/45 underline"
                      >
                        Or open car setup page
                      </a>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--paint)]">
                      2 · Connect phone on home Wi‑Fi
                    </p>
                    <label className="mt-2 flex flex-col gap-1 text-xs text-white/45">
                      Car LAN IP
                      <input
                        value={homeHost}
                        onChange={(e) => setHomeHost(e.target.value)}
                        placeholder="192.168.x.x"
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
                    <p className="mt-2 font-mono text-[10px] text-white/35">
                      {homeHost.trim() ? hostToWsUrl(homeHost) : "—"}
                    </p>
                    <div className="mt-3">
                      {blocked ? (
                        <p className="text-xs text-amber-200/85">
                          HTTPS/PWA blocked — use local HTTP or SoftAP page.
                        </p>
                      ) : (
                        <PrimaryBtn
                          disabled={busy || !homeHost.trim()}
                          onClick={() => void connectHomeFlow()}
                        >
                          {busy ? "Connecting…" : "Connect home"}
                        </PrimaryBtn>
                      )}
                    </div>
                  </section>

                  {carStatus && (
                    <p className="text-[11px] text-white/45">
                      Car: home={String(carStatus.home)} state={carStatus.homeState || "—"}{" "}
                      ip={carStatus.ip || "—"} saved={carStatus.savedSsid || "—"}
                    </p>
                  )}
                  {msg && <p className="text-xs text-amber-200/90">{msg}</p>}
                </div>
              )}

              {view === "debug" && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-white/60">
                    Run checks, then Copy and paste the dump here in chat.
                  </p>
                  <div className="flex flex-col gap-2">
                    <PrimaryBtn
                      tone="muted"
                      disabled={probing}
                      onClick={() => void runSoftProbe()}
                    >
                      {probing ? "Probing…" : "Probe SoftAP"}
                    </PrimaryBtn>
                    <PrimaryBtn
                      tone="muted"
                      onClick={() => {
                        void onRefreshStatus();
                        refreshDebug();
                        pushLog("Status refresh + debug rebuilt", "info");
                      }}
                    >
                      Refresh status
                    </PrimaryBtn>
                    <PrimaryBtn onClick={() => void copyDebug()}>
                      {copied ? "Copied ✓" : "Copy debug dump"}
                    </PrimaryBtn>
                  </div>
                  <pre className="max-h-[40vh] overflow-auto rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-[10px] leading-relaxed text-white/65 whitespace-pre-wrap">
                    {debugText || "Tap “Copy debug dump” after probing."}
                  </pre>
                  <ToggleSwitch
                    label="Cockpit debug overlay"
                    checked={debug}
                    onChange={onDebugChange}
                    hint="Shows live numbers on the camera."
                  />
                  {saved.length > 0 && (
                    <div className="rounded-xl border border-white/10 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-white/40">
                        Saved
                      </p>
                      <ul className="mt-2 space-y-2">
                        {saved.map((n) => (
                          <li
                            key={n.id}
                            className="flex items-center justify-between gap-2 text-xs text-white/60"
                          >
                            <button
                              type="button"
                              className="text-left underline"
                              onClick={() => {
                                if (n.mode === "hotspot") void connectHotspotFlow();
                                else {
                                  setHomeHost(n.host);
                                  setView("home");
                                }
                              }}
                            >
                              {n.label} · {n.host}
                            </button>
                            <button
                              type="button"
                              className="text-white/35"
                              onClick={() => setSaved(forgetSavedNetwork(n.id))}
                            >
                              Forget
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <PrimaryBtn
                    tone="muted"
                    onClick={() => {
                      upsertSavedNetwork({
                        mode: mode === "home" ? "home" : "hotspot",
                        host: mode === "home" ? host || homeHost : AP_HOST,
                        label: mode === "home" ? host || "Home" : AP_SSID,
                      });
                      setSaved(loadSavedNetworks());
                      pushLog("Saved current link", "ok");
                    }}
                  >
                    Save current link
                  </PrimaryBtn>
                  {linked && (
                    <PrimaryBtn tone="muted" onClick={onDisconnect}>
                      Disconnect
                    </PrimaryBtn>
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

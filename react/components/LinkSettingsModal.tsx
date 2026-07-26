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
  connectSavedCarWifi,
  fetchSavedCarWifi,
  forgetCarWifi,
  getNetworkKind,
  httpsBlocksLocalCar,
  isHttpsApp,
  isStandalonePwa,
  networkKindLabel,
  openCarSetupPage,
  openCarSoftApPage,
  openDeviceWifiSettings,
  pickCarControlHost,
  probeCarHost,
  probeSoftAp,
  saveCarWifi,
  scanSoftApNetworks,
  softApGuessLabel,
  type NetKind,
  type ProbeResult,
  type SavedCarWifi,
  type ScannedNetwork,
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
  const toneCls =
    tone === "ok"
      ? "link-btn-ok"
      : tone === "muted"
        ? "link-btn-muted"
        : "link-btn-paint";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`link-btn ${toneCls}`}
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
  const [scanNets, setScanNets] = useState<ScannedNetwork[]>([]);
  const [scanning, setScanning] = useState(false);
  const [savedCarNets, setSavedCarNets] = useState<SavedCarWifi[]>([]);
  const [showJoinWifi, setShowJoinWifi] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const onCarStatusRef = useRef(onCarStatus);
  onCarStatusRef.current = onCarStatus;

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
    const width = vw * 0.45;
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
    if (!open) {
      wasOpen.current = false;
      return;
    }
    const justOpened = !wasOpen.current;
    wasOpen.current = true;

    // Only reset the tab when Link opens — not when host/status updates mid-flow
    if (justOpened) {
      setView("guide");
      setMsg(null);
      setScanNets([]);
      setSavedCarNets([]);
      setShowJoinWifi(false);
      setSoftProbe(null);
      setHomeProbe(null);
      setHttps(isHttpsApp());
      setPwa(isStandalonePwa());
      setNetKind(getNetworkKind());
      setSaved(loadSavedNetworks());
    }

    const knownHome =
      (host || "").trim() ||
      (carStatus?.home && carStatus.ip ? carStatus.ip : "") ||
      "";
    if (justOpened || !homeHost.trim()) {
      setHomeHost(knownHome || host || "");
    }

    if (!justOpened) return;

    void (async () => {
      setProbing(true);
      pushLog("Checking SoftAP + home…", "info");
      const homeTarget = knownHome && knownHome !== AP_HOST ? knownHome : "";
      const [soft, home] = await Promise.all([
        probeSoftAp(),
        homeTarget
          ? probeCarHost(homeTarget, 4000)
          : Promise.resolve(null as ProbeResult | null),
      ]);
      setSoftProbe(soft);
      setHomeProbe(home);

      if (soft.ok && soft.status) {
        onCarStatusRef.current?.(soft.status);
        pushLog(
          `SoftAP OK ${soft.ms}ms · home=${soft.status.home} ip=${soft.status.ip || "—"}`,
          "ok",
        );
        if (soft.status.ip) setHomeHost(soft.status.ip);
        if (soft.status.savedSsid) setCarSsid(soft.status.savedSsid);
        if (soft.status.networks?.length) setSavedCarNets(soft.status.networks);
        else void fetchSavedCarWifi(AP_HOST).then((r) => {
          if (r.ok) setSavedCarNets(r.networks);
        });
      } else {
        pushLog(
          `SoftAP unreachable (${soft.error || "timeout"}) — normal if phone is on home Wi‑Fi`,
          "warn",
        );
      }

      if (home?.ok && home.status) {
        onCarStatusRef.current?.(home.status);
        const ip = home.status.ip || homeTarget;
        if (ip) setHomeHost(ip);
        pushLog(`Home car OK ${home.ms}ms @ ${ip}`, "ok");
      } else if (homeTarget) {
        pushLog(
          `Home probe ${homeTarget} failed: ${home?.error || "no response"}`,
          "err",
        );
      }

      setProbing(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, host]);

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
  const homeIp =
    homeHost.trim() ||
    homeProbe?.status?.ip ||
    carStatus?.ip ||
    host ||
    "";
  const homeReady =
    Boolean(homeProbe?.ok) ||
    Boolean(carStatus?.home && carStatus.ip && wsState === "idle");
  const softReady = Boolean(softProbe?.ok);
  /** SoftAP if phone is on hotspot, else car LAN IP (e.g. 192.168.2.203) */
  const carCtlHost = pickCarControlHost({
    softApOk: softReady,
    lanIp: carStatus?.ip || homeProbe?.status?.ip || "",
    fallback: homeHost || host,
  });
  const canTalkHttp = !blocked;
  /** SoftAP reachable — drive first; place Wi‑Fi is optional later */
  const onSoftApLink =
    softReady ||
    (linked && mode === "hotspot") ||
    Boolean(softProbe?.ok && softProbe.status?.ap);

  const rssiBars = (rssi: number) => {
    if (rssi >= -55) return "▂▄▆█";
    if (rssi >= -65) return "▂▄▆░";
    if (rssi >= -75) return "▂▄░░";
    return "▂░░░";
  };

  const refreshSavedNets = async () => {
    const r = await fetchSavedCarWifi(carCtlHost);
    if (r.ok) setSavedCarNets(r.networks);
    return r;
  };

  const renderSavedNets = () => {
    const nets =
      savedCarNets.length > 0
        ? savedCarNets
        : carStatus?.networks || [];
    if (!nets.length) return null;
    return (
      <ul className="mt-2 max-h-32 overflow-y-auto rounded-xl border border-white/10 bg-black/25 sm:max-h-40">
        {nets
          .slice()
          .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
          .map((n) => (
            <li
              key={n.ssid}
              className="flex items-center gap-2 border-b border-white/5 px-2.5 py-1.5 last:border-0 sm:px-3 sm:py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] text-white/85 sm:text-sm">
                  {n.ssid}
                  {n.active ? (
                    <span className="ml-1 text-[9px] text-emerald-300">active</span>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 text-[9px] text-sky-200 underline sm:text-[10px]"
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    const r = await connectSavedCarWifi(n.ssid, carCtlHost);
                    pushLog(
                      r.ok ? `Joining saved ${n.ssid}` : r.error || "Join failed",
                      r.ok ? "ok" : "err",
                    );
                    setTimeout(() => void runSoftProbe(), 3000);
                    setBusy(false);
                  })()
                }
              >
                Join
              </button>
              <button
                type="button"
                className="shrink-0 text-[9px] text-rose-300 underline sm:text-[10px]"
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    const r = await forgetCarWifi(n.ssid, carCtlHost);
                    if (r.ok) {
                      setSavedCarNets(r.networks || []);
                      pushLog(`Deleted ${n.ssid}`, "ok");
                    } else {
                      pushLog(r.error || "Delete failed", "err");
                    }
                    setBusy(false);
                  })()
                }
              >
                Delete
              </button>
            </li>
          ))}
      </ul>
    );
  };

  const renderJoinWifiCard = () => (
    <section className="link-card rounded-2xl border border-sky-400/30 bg-sky-400/10 p-3 sm:rounded-3xl sm:p-4">
      <p className="text-[8px] uppercase tracking-[0.14em] text-sky-200/90">
        Place Wi‑Fi on car
      </p>

      {!canTalkHttp ? (
        <>
          <p className="mt-1 text-[11px] leading-snug text-amber-100 sm:text-sm">
            This app is on <b>HTTPS</b> (Vercel). Browsers block Save from here — the button
            is not broken; it cannot reach the car. Join SoftAP, then open the car’s HTTP
            setup page and enter Wi‑Fi there.
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-[10px] text-white/65 sm:text-xs">
            <li>
              Phone Wi‑Fi → <span className="font-mono text-white/85">{AP_SSID}</span> /{" "}
              <span className="font-mono text-white/85">{AP_PASS}</span>
            </li>
            <li>Close any “login” popup (you’re already connected)</li>
            <li>Tap the button below → enter home Wi‑Fi on the car page</li>
          </ol>
          <div className="mt-2.5 flex flex-col gap-1.5 sm:mt-3 sm:gap-2">
            <PrimaryBtn
              tone="ok"
              onClick={() => {
                pushLog(`Open setup http://${AP_HOST}/setup (HTTPS app)`, "info");
                openCarSetupPage(AP_HOST);
              }}
            >
              Save &amp; join on car · open setup
            </PrimaryBtn>
            <PrimaryBtn
              tone="muted"
              onClick={() => {
                pushLog("Open SoftAP status", "info");
                openCarSoftApPage();
              }}
            >
              Open http://{AP_HOST}/
            </PrimaryBtn>
            <p className="text-[9px] text-white/40 sm:text-[10px]">
              For in-app Save: use http://localhost:3000 (not vercel.app).
            </p>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-[11px] leading-snug text-white/70 sm:text-sm">
            SoftAP stays on. Save up to 10 places — a new join drops the least-recently
            used if full.
          </p>
          <p className="mt-1 font-mono text-[9px] text-sky-100/60">
            Saving via http://{carCtlHost}/wifi
          </p>
          {renderSavedNets()}
          <div className="mt-2.5 flex flex-col gap-1.5 sm:mt-3 sm:gap-2">
            <PrimaryBtn
              tone="muted"
              disabled={scanning || busy}
              onClick={() => void runWifiScan()}
            >
              {scanning ? "Scanning…" : "Scan nearby Wi‑Fi"}
            </PrimaryBtn>
            {scanNets.length > 0 && (
              <ul className="max-h-36 overflow-y-auto rounded-xl border border-white/10 bg-black/25 sm:max-h-44">
                {scanNets.map((n) => (
                  <li key={`${n.ssid}-${n.rssi}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setCarSsid(n.ssid);
                        pushLog(`Selected ${n.ssid} (${n.rssi} dBm)`, "info");
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] sm:px-3 sm:py-2 sm:text-sm ${
                        carSsid === n.ssid
                          ? "bg-[var(--paint)]/20 text-[var(--paint)]"
                          : "text-white/80 hover:bg-white/5"
                      }`}
                    >
                      <span className="min-w-0 truncate">{n.ssid}</span>
                      <span className="shrink-0 font-mono text-[9px] text-white/45 sm:text-[10px]">
                        {rssiBars(n.rssi)} {n.rssi}
                        {n.secure ? "" : " · open"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              value={carSsid}
              onChange={(e) => setCarSsid(e.target.value)}
              placeholder="SSID (2.4 GHz)"
              className="link-input rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-[var(--paint)] sm:rounded-xl sm:px-3 sm:py-2.5 sm:text-sm"
            />
            <input
              value={carPass}
              onChange={(e) => setCarPass(e.target.value)}
              type="password"
              placeholder="Password"
              className="link-input rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-[var(--paint)] sm:rounded-xl sm:px-3 sm:py-2.5 sm:text-sm"
            />
            <PrimaryBtn
              tone="ok"
              disabled={!carSsid.trim() || busy}
              onClick={() => void saveWifiOnCar()}
            >
              {busy ? "Saving…" : "Save & join on car"}
            </PrimaryBtn>
          </div>
        </>
      )}
    </section>
  );

  const runSoftProbe = async () => {
    setProbing(true);
    pushLog("Probe SoftAP 192.168.4.1/status…", "info");
    const r = await probeSoftAp();
    setSoftProbe(r);
    if (r.ok && r.status) {
      onCarStatusRef.current?.(r.status);
      pushLog(`SoftAP OK ${r.ms}ms home=${r.status.home} ip=${r.status.ip || "—"}`, "ok");
      if (r.status.ip) setHomeHost(r.status.ip);
      if (r.status.savedSsid) setCarSsid(r.status.savedSsid);
    } else {
      pushLog(r.error || "SoftAP probe failed", "err");
    }
    setProbing(false);
    return r;
  };

  const runWifiScan = async () => {
    if (httpsBlocksLocalCar()) {
      setMsg(`Scan needs HTTP — open http://${carCtlHost}/setup or use http://localhost:3000.`);
      return;
    }
    setScanning(true);
    setMsg(null);
    pushLog(`Scanning Wi‑Fi from car @ ${carCtlHost}…`, "info");
    const r = await scanSoftApNetworks(12000, carCtlHost);
    setScanning(false);
    if (!r.ok) {
      pushLog(r.error || "Scan failed", "err");
      setMsg(
        softReady
          ? "Scan failed — stay on SoftAP and try again."
          : `Scan failed via ${carCtlHost}. Join SoftAP or use car LAN IP.`,
      );
      return;
    }
    setScanNets(r.networks);
    pushLog(`Found ${r.networks.length} networks`, "ok");
    if (!r.networks.length) setMsg("No networks found. Try again near the router.");
  };

  const saveWifiOnCar = async () => {
    const ssid = carSsid.trim();
    if (!ssid) return;
    if (httpsBlocksLocalCar()) {
      setMsg(`HTTPS blocks save — open http://${carCtlHost}/setup`);
      openCarSetupPage(carCtlHost);
      return;
    }
    setBusy(true);
    setMsg(null);
    pushLog(`Save Wi‑Fi on car → ${ssid} @ ${carCtlHost}`, "info");
    const r = await saveCarWifi(ssid, carPass, carCtlHost);
    if (!r.ok) {
      // Retry SoftAP if we used LAN and it failed (or vice versa)
      if (carCtlHost !== AP_HOST) {
        pushLog(`Retry SoftAP ${AP_HOST}…`, "warn");
        const r2 = await saveCarWifi(ssid, carPass, AP_HOST);
        if (r2.ok) {
          pushLog("Wi‑Fi saved via SoftAP — STA joining…", "ok");
          if (r2.networks) setSavedCarNets(r2.networks);
          setMsg("Saved via SoftAP. SoftAP stays up — you can keep driving.");
          setTimeout(() => void runSoftProbe(), 4000);
          setBusy(false);
          return;
        }
      }
      pushLog(r.error || "Save failed", "err");
      setMsg(
        `Save failed via ${carCtlHost}. Join SoftAP (${AP_SSID}) and retry, or open http://${carCtlHost}/setup`,
      );
      setBusy(false);
      return;
    }
    pushLog("Wi‑Fi saved on car — STA joining…", "ok");
    if (r.networks) setSavedCarNets(r.networks);
    else void refreshSavedNets();
    setMsg("Saved (max 10 places). SoftAP stays up — you can keep driving.");
    setTimeout(() => void runSoftProbe(), 4000);
    setBusy(false);
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
    onCarStatusRef.current?.(probe.status ?? null);
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
        : !softProbe?.ok && (homeProbe?.ok || (carStatus?.home && carStatus.ip))
          ? `SoftAP timeout is normal on home Wi‑Fi. Tap Connect home → ${homeHost || carStatus?.ip || host}. wsState idle means not linked yet.`
          : wsState === "idle"
            ? "wsState idle = WebSocket not open. Use Connect home/hotspot — SoftAP probe can fail while home works."
            : "SoftAP + home STA run together. SoftAP fail + home OK = stay on home Wi‑Fi and Connect home.",
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
            <header className="link-fs-head flex w-full items-start justify-between gap-2 px-2.5 pb-2 pt-[max(0.45rem,env(safe-area-inset-top))] sm:gap-3 sm:px-4 sm:pb-3 sm:pt-[max(0.75rem,env(safe-area-inset-top))]">
              <div>
                <p className="link-fs-eyebrow text-[8px] uppercase tracking-[0.18em] text-white/35 sm:text-[10px] sm:tracking-[0.2em]">
                  GT2 RS
                </p>
                <h1 className="link-fs-title font-[family-name:var(--font-display)] text-lg tracking-[0.1em] text-[var(--paint)] sm:text-2xl sm:tracking-[0.12em]">
                  LINK
                </h1>
                <p className="link-fs-status mt-0.5 flex items-center gap-1.5 text-[10px] text-white/50 sm:mt-1 sm:gap-2 sm:text-xs">
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
                className="link-fs-close rounded-full border border-white/15 px-2.5 py-1 text-[10px] text-white/60 hover:bg-white/5 sm:px-3 sm:py-1.5 sm:text-xs"
              >
                Close
              </button>
            </header>

            <nav className="link-fs-nav flex w-full gap-0.5 overflow-x-auto border-b border-white/10 px-1.5 sm:gap-1 sm:px-4">
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
                    if (id === "home" && softProbe?.ok) void refreshSavedNets();
                  }}
                  className={`link-fs-tab shrink-0 px-2.5 py-1.5 text-[10px] tracking-wide sm:px-3 sm:py-2.5 sm:text-xs ${
                    view === id
                      ? "border-b-2 border-[var(--paint)] text-[var(--paint)]"
                      : "text-white/40 hover:text-white/65"
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="link-fs-body min-h-0 w-full flex-1 overflow-y-auto px-2.5 py-2.5 sm:px-4 sm:py-4">
              {blocked && (
                <div className="link-fs-banner mb-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2.5 text-[11px] leading-snug text-amber-100 sm:mb-4 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm">
                  <p className="font-medium">
                    HTTPS (Vercel) can’t talk to the car
                  </p>
                  <p className="mt-1 text-[10px] text-amber-100/75 sm:text-xs">
                    Join SoftAP <strong>{AP_SSID}</strong> / <strong>{AP_PASS}</strong>, then open
                    the car’s HTTP drive page — Home Screen / Vercel{" "}
                    <strong>cannot</strong> move motors (HTTPS blocks ws://).
                  </p>
                  <div className="mt-2.5 flex flex-col gap-1.5 sm:mt-3">
                    <PrimaryBtn
                      tone="ok"
                      onClick={() => {
                        const url = `http://${AP_HOST}/drive`;
                        pushLog(`Open SoftAP drive ${url}`, "info");
                        const w = window.open(url, "_blank", "noopener,noreferrer");
                        if (!w) window.location.href = url;
                      }}
                    >
                      Drive on SoftAP · http://{AP_HOST}/drive
                    </PrimaryBtn>
                    <PrimaryBtn
                      tone="muted"
                      onClick={() => {
                        pushLog("Open SoftAP Wi‑Fi setup", "info");
                        openCarSetupPage(AP_HOST);
                      }}
                    >
                      Save Wi‑Fi on car · http://{AP_HOST}/setup
                    </PrimaryBtn>
                    <PrimaryBtn
                      tone="muted"
                      onClick={() => {
                        pushLog("Opening SoftAP status", "info");
                        openCarSoftApPage();
                      }}
                    >
                      SoftAP status · http://{AP_HOST}/
                    </PrimaryBtn>
                  </div>
                </div>
              )}

              {view === "guide" && (
                <div className="link-stack flex flex-col gap-2.5 sm:gap-4">
                  {/* Live car status */}
                  <section className="link-card rounded-2xl border border-white/15 bg-white/[0.05] p-3 sm:rounded-3xl sm:p-4">
                    <p className="text-[8px] uppercase tracking-[0.14em] text-white/40">
                      Car status
                    </p>
                    <ul className="mt-2 space-y-1.5 text-[11px] text-white/75 sm:text-sm">
                      <li>
                        <span className="text-white/40">Hotspot · </span>
                        {softReady || carStatus?.ap ? (
                          <span className="text-emerald-300">
                            {carStatus?.hotspot || AP_SSID} @{" "}
                            {carStatus?.hotspotIp || carStatus?.apIp || AP_HOST}
                          </span>
                        ) : (
                          <span className="text-amber-200/80">not reachable from this phone</span>
                        )}
                      </li>
                      <li>
                        <span className="text-white/40">Place Wi‑Fi · </span>
                        {carStatus?.home && carStatus.ssid ? (
                          <span className="text-emerald-300">
                            {carStatus.ssid}
                            {carStatus.ip ? ` · ${carStatus.ip}` : ""}
                          </span>
                        ) : carStatus?.tryingSsid ||
                          (carStatus?.homeState === "connecting" && carStatus.ssid) ? (
                          <span className="text-amber-200">
                            trying {carStatus.tryingSsid || carStatus.ssid}…
                          </span>
                        ) : (
                          <span className="text-white/45">none active</span>
                        )}
                      </li>
                      <li>
                        <span className="text-white/40">App link · </span>
                        <span className={linked ? "text-emerald-300" : "text-white/45"}>
                          {linked
                            ? mode === "hotspot"
                              ? `hotspot WS open`
                              : `home WS · ${host || homeIp || "—"}`
                            : wsState === "connecting"
                              ? "connecting…"
                              : "not linked"}
                        </span>
                      </li>
                      <li>
                        <span className="text-white/40">Saved places · </span>
                        <span className="text-white/80">
                          {(savedCarNets.length || carStatus?.networks?.length || carStatus?.savedCount || 0)}
                          /{carStatus?.savedMax || 10}
                        </span>
                      </li>
                    </ul>
                  </section>

                  {linked ? (
                    <section className="link-card rounded-2xl border border-emerald-400/35 bg-emerald-400/10 p-3 sm:rounded-3xl sm:p-4">
                      <p className="text-[11px] text-emerald-100 sm:text-sm">
                        You’re linked. Close and drive — SoftAP stays on.
                      </p>
                      <div className="mt-2 flex flex-col gap-1.5 sm:mt-3 sm:gap-2">
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
                      {!blocked && softReady && (
                        <section className="link-card rounded-2xl border border-[var(--paint)]/35 bg-[var(--paint)]/10 p-3 sm:rounded-3xl sm:p-4">
                          <p className="text-[8px] uppercase tracking-[0.14em] text-[var(--paint)]">
                            1 · Drive on hotspot
                          </p>
                          <p className="mt-1 text-[11px] text-white/70 sm:text-sm">
                            Phone is on SoftAP. Tap connect — no home password needed.
                          </p>
                          <div className="mt-2.5 sm:mt-3">
                            <PrimaryBtn disabled={busy} onClick={() => void connectHotspotFlow()}>
                              {busy ? "Connecting…" : "Connect hotspot"}
                            </PrimaryBtn>
                          </div>
                        </section>
                      )}

                      {!blocked && !softReady && homeIp && (homeReady || carStatus?.home) && (
                        <section className="link-card rounded-2xl border border-emerald-400/35 bg-emerald-400/10 p-3 sm:rounded-3xl sm:p-4">
                          <p className="text-[8px] uppercase tracking-[0.14em] text-emerald-300/80">
                            Drive on place Wi‑Fi
                          </p>
                          <p className="mt-1 text-[11px] text-emerald-50/90 sm:text-sm">
                            Car is online at {homeIp}
                            {carStatus?.ssid ? ` (${carStatus.ssid})` : ""}.
                          </p>
                          <div className="mt-2.5 sm:mt-3">
                            <PrimaryBtn
                              tone="ok"
                              disabled={busy}
                              onClick={() => {
                                setHomeHost(homeIp);
                                void connectHomeFlow();
                              }}
                            >
                              {busy ? "Connecting…" : `Connect · ${homeIp}`}
                            </PrimaryBtn>
                          </div>
                        </section>
                      )}

                      {!softReady && (
                        <section className="link-card rounded-xl border border-white/10 bg-black/20 p-2.5 sm:rounded-2xl sm:p-3">
                          <p className="text-[10px] text-white/60 sm:text-xs">
                            SoftAP not reachable. Join Wi‑Fi{" "}
                            <span className="font-mono text-white/85">
                              {AP_SSID} / {AP_PASS}
                            </span>
                            , then return. If a phone popup asks for Wi‑Fi password,{" "}
                            <b className="text-white/80">close it</b> — you’re already on the car.
                          </p>
                          <div className="mt-2 flex flex-col gap-1.5 sm:mt-3">
                            <PrimaryBtn tone="muted" onClick={changeWifi}>
                              Open phone Wi‑Fi settings
                            </PrimaryBtn>
                            <PrimaryBtn
                              tone="muted"
                              disabled={probing}
                              onClick={() => void runSoftProbe()}
                            >
                              {probing ? "Checking…" : "Check SoftAP again"}
                            </PrimaryBtn>
                          </div>
                        </section>
                      )}
                    </>
                  )}

                  {/* Saved place Wi‑Fi — easy pick / other */}
                  {(onSoftApLink || softReady || linked) && (
                    <section className="link-card rounded-2xl border border-sky-400/30 bg-sky-400/10 p-3 sm:rounded-3xl sm:p-4">
                      <p className="text-[8px] uppercase tracking-[0.14em] text-sky-200/90">
                        2 · Place Wi‑Fi for the car (optional)
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-white/65 sm:text-sm">
                        SoftAP stays on. Pick a saved network, or add another (password stays on
                        the car). Max 10 — newest join drops least-recently used.
                      </p>

                      {(carStatus?.tryingSsid ||
                        (carStatus?.homeState === "connecting" && carStatus.ssid)) && (
                        <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-[10px] text-amber-100">
                          Trying now:{" "}
                          <span className="font-mono">
                            {carStatus.tryingSsid || carStatus.ssid}
                          </span>
                        </p>
                      )}

                      {carStatus?.home && carStatus.ssid && (
                        <p className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1.5 text-[10px] text-emerald-100">
                          Active now: <span className="font-mono">{carStatus.ssid}</span>
                          {carStatus.ip ? ` · ${carStatus.ip}` : ""} · password saved on car
                        </p>
                      )}

                      <div className="mt-2.5 flex flex-col gap-1.5 sm:mt-3 sm:gap-2">
                        {(savedCarNets.length > 0
                          ? savedCarNets
                          : carStatus?.networks || []
                        )
                          .slice()
                          .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
                          .map((n) => (
                            <div key={n.ssid} className="flex gap-1.5">
                              <PrimaryBtn
                                tone={n.active || carStatus?.ssid === n.ssid ? "ok" : "muted"}
                                disabled={busy || !canTalkHttp}
                                onClick={() =>
                                  void (async () => {
                                    setBusy(true);
                                    pushLog(`Connect saved ${n.ssid}`, "info");
                                    const r = await connectSavedCarWifi(n.ssid, carCtlHost);
                                    if (r.ok) {
                                      setMsg(`Car joining ${n.ssid} (password already saved)…`);
                                      setTimeout(() => void runSoftProbe(), 3000);
                                    } else {
                                      setMsg(r.error || "Join failed");
                                    }
                                    setBusy(false);
                                  })()
                                }
                              >
                                {n.active || carStatus?.ssid === n.ssid
                                  ? `Saved · ${n.ssid} (active)`
                                  : `Use saved · ${n.ssid}`}
                              </PrimaryBtn>
                              <button
                                type="button"
                                disabled={busy || !canTalkHttp}
                                className="shrink-0 rounded-xl border border-rose-400/30 px-2 text-[9px] text-rose-200"
                                onClick={() =>
                                  void (async () => {
                                    setBusy(true);
                                    const r = await forgetCarWifi(n.ssid, carCtlHost);
                                    if (r.ok) setSavedCarNets(r.networks || []);
                                    setBusy(false);
                                  })()
                                }
                              >
                                Del
                              </button>
                            </div>
                          ))}

                        {!showJoinWifi ? (
                          <PrimaryBtn
                            tone="muted"
                            onClick={() => {
                              setShowJoinWifi(true);
                              if (canTalkHttp) void refreshSavedNets();
                            }}
                          >
                            {canTalkHttp
                              ? "Other Wi‑Fi… (enter name & password)"
                              : "Other Wi‑Fi… (opens car setup on HTTPS)"}
                          </PrimaryBtn>
                        ) : canTalkHttp ? (
                          <>
                            <PrimaryBtn
                              tone="muted"
                              disabled={scanning || busy}
                              onClick={() => void runWifiScan()}
                            >
                              {scanning ? "Scanning…" : "Scan nearby Wi‑Fi"}
                            </PrimaryBtn>
                            {scanNets.length > 0 && (
                              <ul className="max-h-32 overflow-y-auto rounded-xl border border-white/10 bg-black/25">
                                {scanNets.map((n) => (
                                  <li key={`${n.ssid}-${n.rssi}`}>
                                    <button
                                      type="button"
                                      className="flex w-full justify-between px-2.5 py-1.5 text-left text-[11px] text-white/80"
                                      onClick={() => setCarSsid(n.ssid)}
                                    >
                                      <span className="truncate">{n.ssid}</span>
                                      <span className="font-mono text-[9px] text-white/40">
                                        {rssiBars(n.rssi)}
                                      </span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                            <input
                              value={carSsid}
                              onChange={(e) => setCarSsid(e.target.value)}
                              placeholder="Wi‑Fi name (SSID)"
                              className="link-input rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-[var(--paint)]"
                            />
                            <input
                              value={carPass}
                              onChange={(e) => setCarPass(e.target.value)}
                              type="password"
                              placeholder="Password"
                              className="link-input rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-[var(--paint)]"
                            />
                            <PrimaryBtn
                              tone="ok"
                              disabled={!carSsid.trim() || busy}
                              onClick={() => void saveWifiOnCar()}
                            >
                              {busy ? "Saving…" : "Save password & join on car"}
                            </PrimaryBtn>
                            <button
                              type="button"
                              className="text-[10px] text-white/40 underline"
                              onClick={() => setShowJoinWifi(false)}
                            >
                              Hide
                            </button>
                          </>
                        ) : (
                          <>
                            <p className="text-[10px] text-amber-100/90 sm:text-xs">
                              HTTPS can’t save from this form. Use the car page instead.
                            </p>
                            <PrimaryBtn
                              tone="ok"
                              onClick={() => {
                                pushLog(`Open setup http://${AP_HOST}/setup`, "info");
                                openCarSetupPage(AP_HOST);
                              }}
                            >
                              Save &amp; join on car · open setup
                            </PrimaryBtn>
                            <button
                              type="button"
                              className="text-[10px] text-white/40 underline"
                              onClick={() => setShowJoinWifi(false)}
                            >
                              Hide
                            </button>
                          </>
                        )}
                      </div>
                    </section>
                  )}

                  {msg && <p className="text-[10px] text-amber-200/90 sm:text-xs">{msg}</p>}
                </div>
              )}

              {view === "away" && (
                <div className="link-stack flex flex-col gap-2.5 sm:gap-4">
                  <div>
                    <h2 className="font-[family-name:var(--font-display)] text-sm tracking-wide sm:text-lg">
                      Away
                    </h2>
                    <p className="mt-0.5 text-[10px] leading-snug text-white/55 sm:mt-1 sm:text-sm">
                      Join SoftAP in phone Settings. If a login popup appears, close it — you
                      are already on the car. Do not type home Wi‑Fi there.
                    </p>
                  </div>
                  <ol className="space-y-2 text-[11px] text-white/70 sm:space-y-3 sm:text-sm">
                    <li className="link-card rounded-xl border border-white/10 bg-black/20 p-2.5 sm:rounded-2xl sm:p-3">
                      <p className="text-[8px] uppercase tracking-wider text-[var(--paint)] sm:text-[10px]">
                        1 · Join Wi‑Fi
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-white/85 sm:mt-1 sm:text-xs">
                        {AP_SSID} · {AP_PASS}
                      </p>
                      <div className="mt-2 sm:mt-3">
                        <PrimaryBtn tone="muted" onClick={changeWifi}>
                          Open Wi‑Fi settings
                        </PrimaryBtn>
                      </div>
                    </li>
                    <li className="link-card rounded-xl border border-white/10 bg-black/20 p-2.5 sm:rounded-2xl sm:p-3">
                      <p className="text-[8px] uppercase tracking-wider text-[var(--paint)] sm:text-[10px]">
                        2 · Check car
                      </p>
                      <p className="mt-0.5 text-[10px] text-white/50 sm:mt-1 sm:text-xs">{softApGuessLabel(softProbe)}</p>
                      <div className="mt-2 sm:mt-3">
                        <PrimaryBtn
                          tone="muted"
                          disabled={probing}
                          onClick={() => void runSoftProbe()}
                        >
                          {probing ? "Checking…" : "Check SoftAP"}
                        </PrimaryBtn>
                      </div>
                    </li>
                    <li className="link-card rounded-xl border border-white/10 bg-black/20 p-2.5 sm:rounded-2xl sm:p-3">
                      <p className="text-[8px] uppercase tracking-wider text-[var(--paint)] sm:text-[10px]">
                        3 · Connect
                      </p>
                      {blocked ? (
                        <div className="mt-2 sm:mt-3">
                          <PrimaryBtn onClick={openCarSoftApPage}>
                            Open http://{AP_HOST}/
                          </PrimaryBtn>
                        </div>
                      ) : (
                        <div className="mt-2 sm:mt-3">
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
                  {wifiHint && <p className="text-[10px] text-amber-200/90 sm:text-xs">{wifiHint}</p>}
                  {msg && <p className="text-[10px] text-amber-200/90 sm:text-xs">{msg}</p>}
                </div>
              )}

              {view === "home" && (
                <div className="link-stack flex flex-col gap-2.5 sm:gap-4">
                  <div>
                    <h2 className="font-[family-name:var(--font-display)] text-sm tracking-wide sm:text-lg">
                      Home
                    </h2>
                    <p className="mt-0.5 text-[10px] leading-snug text-white/55 sm:mt-1 sm:text-sm">
                      SoftAP stays up. Teach the car a place Wi‑Fi, then connect by LAN IP.
                    </p>
                  </div>

                  {renderJoinWifiCard()}

                  {!blocked && (
                  <section className="link-card rounded-xl border border-white/10 bg-black/20 p-2.5 sm:rounded-2xl sm:p-3">
                    <p className="text-[8px] uppercase tracking-wider text-[var(--paint)] sm:text-[10px]">
                      Connect phone on home Wi‑Fi
                    </p>
                    <label className="mt-1.5 flex flex-col gap-0.5 text-[9px] text-white/45 sm:mt-2 sm:gap-1 sm:text-xs">
                      Car LAN IP
                      <input
                        value={homeHost}
                        onChange={(e) => setHomeHost(e.target.value)}
                        placeholder="192.168.x.x"
                        className="link-input rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-white outline-none focus:border-[var(--paint)] sm:rounded-xl sm:px-3 sm:py-2.5 sm:text-sm"
                      />
                    </label>
                    {carStatus?.ip && (
                      <button
                        type="button"
                        className="mt-1.5 text-left text-[10px] text-emerald-300 underline sm:mt-2 sm:text-xs"
                        onClick={() => setHomeHost(carStatus.ip || "")}
                      >
                        Use {carStatus.ip}
                      </button>
                    )}
                    <p className="mt-1.5 font-mono text-[9px] text-white/35 sm:mt-2 sm:text-[10px]">
                      {homeHost.trim() ? hostToWsUrl(homeHost) : "—"}
                    </p>
                    <div className="mt-2 sm:mt-3">
                      <PrimaryBtn
                        disabled={busy || !homeHost.trim()}
                        onClick={() => void connectHomeFlow()}
                      >
                        {busy ? "Connecting…" : "Connect home"}
                      </PrimaryBtn>
                    </div>
                  </section>
                  )}

                  {carStatus && (
                    <p className="text-[9px] leading-snug text-white/45 sm:text-[11px]">
                      Car: home={String(carStatus.home)} state={carStatus.homeState || "—"}{" "}
                      ip={carStatus.ip || "—"} saved={carStatus.savedSsid || "—"}
                    </p>
                  )}
                  {msg && <p className="text-[10px] text-amber-200/90 sm:text-xs">{msg}</p>}
                </div>
              )}

              {view === "debug" && (
                <div className="link-stack flex flex-col gap-2 sm:gap-3">
                  <p className="text-[10px] text-white/60 sm:text-sm">
                    Run checks, then Copy and paste the dump here in chat.
                  </p>
                  <div className="flex flex-col gap-1.5 sm:gap-2">
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
                  <pre className="max-h-[32vh] overflow-auto rounded-lg border border-white/10 bg-black/50 p-2 font-mono text-[9px] leading-relaxed whitespace-pre-wrap text-white/65 sm:max-h-[40vh] sm:rounded-xl sm:p-3 sm:text-[10px]">
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

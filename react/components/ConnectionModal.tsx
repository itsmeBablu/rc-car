"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnPhase, LinkPath } from "@/hooks/useCarConnection";
import {
  AP_IP,
  AP_PASS,
  type VideoQuality,
  VIDEO_QUALITY_OPTIONS,
} from "@/lib/carApi";

type Props = {
  open: boolean;
  onClose: () => void;
  phase: ConnPhase;
  linkPath: LinkPath;
  message: string | null;
  error: string | null;
  homeSsid: string;
  homeLanIp?: string;
  httpsApp?: boolean;
  setupApSsid: string;
  directApSsid: string;
  espIp: string;
  videoQuality: VideoQuality;
  onVideoQuality: (q: VideoQuality) => void | Promise<void>;
  debugUi: boolean;
  onDebugUi: (on: boolean) => void;
  onRetry: () => void;
  onRetryDirect: () => void;
  onProbeIp?: (ip: string) => void | Promise<void>;
  onOpenSetup: () => void;
  onSubmitWifi: (ssid: string, password: string) => Promise<void>;
  onDisconnect: () => void;
  onDisconnectCarHome: () => Promise<void>;
  onForgetCarHome: () => Promise<void>;
  initialSsid?: string;
};

export function ConnectionModal({
  open,
  onClose,
  phase,
  linkPath,
  message,
  error,
  homeSsid,
  homeLanIp = "",
  httpsApp = false,
  directApSsid,
  espIp,
  videoQuality,
  onVideoQuality,
  debugUi,
  onDebugUi,
  onRetry,
  onRetryDirect,
  onProbeIp,
  onOpenSetup,
  onSubmitWifi,
  onDisconnect,
  onDisconnectCarHome,
  onForgetCarHome,
  initialSsid = "",
}: Props) {
  const [ssid, setSsid] = useState(initialSsid);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [wifiBusy, setWifiBusy] = useState(false);
  const [manualIp, setManualIp] = useState(homeLanIp);
  const [videoOpen, setVideoOpen] = useState(false);
  const videoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialSsid) setSsid(initialSsid);
  }, [initialSsid]);

  useEffect(() => {
    if (homeLanIp) setManualIp(homeLanIp);
  }, [homeLanIp]);

  useEffect(() => {
    if (!videoOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!videoRef.current?.contains(e.target as Node)) setVideoOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [videoOpen]);

  useEffect(() => {
    if (!open) setVideoOpen(false);
  }, [open]);

  if (!open) return null;

  const onConnect = async () => {
    setBusy(true);
    try {
      await onSubmitWifi(ssid.trim(), password);
    } finally {
      setBusy(false);
    }
  };

  const probing = phase === "probing";
  const videoOpt =
    VIDEO_QUALITY_OPTIONS.find((o) => o.id === videoQuality) ??
    VIDEO_QUALITY_OPTIONS[0]!;

  return (
    <div
      className="conn-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conn-title"
      onClick={onClose}
    >
      <div className="conn-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="conn-head">
          <div>
            <p className="conn-kicker">RC Car</p>
            <h2 id="conn-title" className="conn-title">
              Link
            </h2>
          </div>
          <button type="button" onClick={onClose} className="conn-x" aria-label="Close">
            ×
          </button>
        </header>

        {probing && (
          <div className="conn-block">
            <div className="conn-pulse" aria-hidden />
            <p className="conn-lead">{message || "Looking for car…"}</p>
            <p className="conn-hint">Usually a few seconds — no push notification.</p>
          </div>
        )}

        {phase === "unreachable" && (
          <div className="conn-block conn-stack">
            <p className="conn-lead">Not on the car’s network yet.</p>

            {httpsApp ? (
              <div className="conn-ios">
                <p className="conn-path-label">iPhone / HTTPS app</p>
                <p className="conn-copy">
                  Safari blocks HTTPS apps from talking to a local{" "}
                  <code className="conn-code">http://</code> address — Safari
                  itself can open the car.
                </p>
                <a
                  className="conn-btn conn-btn-primary"
                  href={`http://${AP_IP}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  SoftAP · {AP_IP}
                </a>
                {homeLanIp ? (
                  <a
                    className="conn-btn conn-btn-primary"
                    href={`http://${homeLanIp}/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Home LAN · {homeLanIp}
                  </a>
                ) : (
                  <p className="conn-foot">
                    No saved home IP yet — connect SoftAP once, set home Wi‑Fi,
                    then reopen from Safari on your router.
                  </p>
                )}
              </div>
            ) : null}

            <div className="conn-row">
              <section className="conn-card">
                <div className="conn-card-top">
                  <span className="conn-badge">A</span>
                  <h3 className="conn-card-title">Home</h3>
                </div>
                <p className="conn-copy">
                  Phone on the same router as the car
                  {homeLanIp ? (
                    <>
                      {" "}
                      · <code className="conn-code">{homeLanIp}</code>
                    </>
                  ) : null}
                </p>
                <button type="button" onClick={onRetry} className="conn-btn conn-btn-primary">
                  Reconnect
                </button>
              </section>

              <section className="conn-card">
                <div className="conn-card-top">
                  <span className="conn-badge">B</span>
                  <h3 className="conn-card-title">Direct</h3>
                </div>
                <p className="conn-copy">
                  Join <strong>{directApSsid}</strong> /{" "}
                  <code className="conn-code">{AP_PASS}</code>
                </p>
                <button
                  type="button"
                  className="conn-btn conn-btn-primary"
                  onClick={onRetryDirect}
                >
                  I’m connected
                </button>
              </section>
            </div>

            {onProbeIp ? (
              <div className="conn-block">
                <p className="conn-path-label">Car IP</p>
                <input
                  className="conn-input"
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  placeholder="192.168.1.50"
                  inputMode="decimal"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="conn-btn"
                  onClick={() => void onProbeIp(manualIp)}
                >
                  Try IP
                </button>
              </div>
            ) : null}

            <p className="conn-foot">
              Ignore “no internet” on SoftAP. Status page:{" "}
              <a className="conn-link" href={`http://${AP_IP}/`} target="_blank" rel="noreferrer">
                http://{AP_IP}/
              </a>
            </p>
          </div>
        )}

        {(phase === "setup" || phase === "connecting_sta") && (
          <div className="conn-block conn-stack">
            <p className="conn-lead">Home Wi‑Fi for the car</p>
            <p className="conn-copy">
              The car joins that network (phone stays on the hotspot until you switch).
            </p>
            <label className="conn-label">
              SSID
              <input
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                disabled={busy || phase === "connecting_sta"}
                className="conn-input"
                autoComplete="off"
              />
            </label>
            <label className="conn-label">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy || phase === "connecting_sta"}
                className="conn-input"
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="conn-btn conn-btn-primary"
              disabled={!ssid.trim() || busy || phase === "connecting_sta"}
              onClick={() => void onConnect()}
            >
              {phase === "connecting_sta" ? "Connecting car…" : "Save & connect car"}
            </button>
            {message ? <p className="conn-status">{message}</p> : null}
            <button type="button" onClick={onRetryDirect} className="conn-btn">
              Drive on hotspot instead
            </button>
          </div>
        )}

        {phase === "switch_phone" && (
          <div className="conn-block conn-stack">
            <p className="conn-lead">Car joined home Wi‑Fi</p>
            <p className="conn-copy whitespace-pre-line">
              {message ||
                `Switch your phone to ${homeSsid || "home Wi‑Fi"}, then reconnect.`}
            </p>
            {espIp ? <p className="conn-mono">Car IP · {espIp}</p> : null}
            {espIp ? (
              <a
                className="conn-btn conn-btn-primary"
                href={`http://${espIp}/`}
                target="_blank"
                rel="noreferrer"
              >
                Open car in Safari
              </a>
            ) : null}
            <button type="button" onClick={onRetry} className="conn-btn conn-btn-primary">
              Reconnect
            </button>
            <button type="button" onClick={onRetryDirect} className="conn-btn">
              Back to hotspot
            </button>
          </div>
        )}

        {phase === "ready" && (
          <div className="conn-block conn-stack">
            <p className="conn-lead conn-ok">Ready to drive</p>

            <div className="conn-path">
              <p className="conn-path-label">
                {linkPath === "direct" ? "Direct hotspot" : "Home Wi‑Fi"}
              </p>
              <p className="conn-path-value">
                {linkPath === "direct"
                  ? directApSsid
                  : homeSsid || "Router"}
              </p>
              <p className="conn-mono">Car · {espIp || AP_IP}</p>
            </div>

            <p className="conn-hint">
              Drive uses a persistent WebSocket. Video is separate HTTP — frames
              drop first if the car is busy.
            </p>

            <button type="button" onClick={onClose} className="conn-btn conn-btn-primary">
              Drive
            </button>

            <div className="conn-video" ref={videoRef}>
              <p className="conn-path-label">Video quality</p>
              <button
                type="button"
                className={`conn-select${videoOpen ? " is-open" : ""}`}
                aria-haspopup="listbox"
                aria-expanded={videoOpen}
                onClick={() => setVideoOpen((v) => !v)}
              >
                <span className="conn-select-value">
                  <strong>{videoOpt.label}</strong>
                  <em>{videoOpt.hint}</em>
                </span>
                <span className="conn-select-chev" aria-hidden>
                  {videoOpen ? "▲" : "▼"}
                </span>
              </button>
              {videoOpen ? (
                <ul className="conn-select-menu" role="listbox">
                  {VIDEO_QUALITY_OPTIONS.map((opt) => (
                    <li key={opt.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={videoQuality === opt.id}
                        className={`conn-select-opt${
                          videoQuality === opt.id ? " is-active" : ""
                        }`}
                        onClick={() => {
                          void onVideoQuality(opt.id);
                          setVideoOpen(false);
                        }}
                      >
                        <strong>{opt.label}</strong>
                        <em>{opt.hint}</em>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="conn-foot">Steering always wins over video.</p>
            </div>

            <label className="conn-debug">
              <input
                type="checkbox"
                checked={debugUi}
                onChange={(e) => onDebugUi(e.target.checked)}
              />
              <span>
                <strong>Debug</strong>
                <em>Show WS / motor / camera overlay</em>
              </span>
            </label>

            <div className="conn-row">
              <button type="button" onClick={onRetry} className="conn-btn">
                Re-scan
              </button>
              {linkPath === "direct" ? (
                <button type="button" onClick={onOpenSetup} className="conn-btn">
                  Set home Wi‑Fi
                </button>
              ) : (
                <button type="button" onClick={onRetryDirect} className="conn-btn">
                  Use hotspot
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onDisconnect}
              className="conn-btn conn-btn-danger"
            >
              Disconnect app
            </button>

            {(linkPath === "direct" || linkPath === "home") && (
              <div className="conn-row">
                <button
                  type="button"
                  disabled={wifiBusy}
                  className="conn-btn"
                  onClick={() => {
                    setWifiBusy(true);
                    void onDisconnectCarHome().finally(() => setWifiBusy(false));
                  }}
                >
                  Drop home Wi‑Fi
                </button>
                <button
                  type="button"
                  disabled={wifiBusy}
                  className="conn-btn"
                  onClick={() => {
                    setWifiBusy(true);
                    void onForgetCarHome().finally(() => setWifiBusy(false));
                  }}
                >
                  Forget home Wi‑Fi
                </button>
              </div>
            )}

            <details className="conn-howto">
              <summary>How the car joins Wi‑Fi</summary>
              <ol className="conn-steps">
                <li>
                  Phone/PC joins the car hotspot <strong>{directApSsid}</strong> — you
                  talk to the car at <strong>{AP_IP}</strong>. That does{" "}
                  <em>not</em> put the car on your home router.
                </li>
                <li>
                  Optional: <strong>Set home Wi‑Fi</strong> sends SSID/password to the
                  ESP. The car then joins your router while the hotspot stays on.
                </li>
                <li>
                  Home drive: switch your phone to that same router, then Reconnect —
                  app uses the car’s LAN IP instead of {AP_IP}.
                </li>
              </ol>
            </details>
          </div>
        )}

        {phase === "idle" && (
          <div className="conn-block">
            <p className="conn-copy">Starting…</p>
          </div>
        )}

        {error ? <p className="conn-error">{error}</p> : null}
      </div>
    </div>
  );
}

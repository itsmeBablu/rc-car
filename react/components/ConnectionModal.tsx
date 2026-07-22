"use client";

import { useEffect, useState } from "react";
import type { ConnPhase, LinkPath } from "@/hooks/useCarConnection";
import { AP_IP, AP_PASS } from "@/lib/carApi";

type Props = {
  open: boolean;
  onClose: () => void;
  phase: ConnPhase;
  linkPath: LinkPath;
  message: string | null;
  error: string | null;
  homeSsid: string;
  setupApSsid: string;
  directApSsid: string;
  espIp: string;
  onRetry: () => void;
  onRetryDirect: () => void;
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
  directApSsid,
  espIp,
  onRetry,
  onRetryDirect,
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

  useEffect(() => {
    if (initialSsid) setSsid(initialSsid);
  }, [initialSsid]);

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

            <div className="conn-row">
              <section className="conn-card">
                <div className="conn-card-top">
                  <span className="conn-badge">A</span>
                  <h3 className="conn-card-title">Home</h3>
                </div>
                <p className="conn-copy">Same router as the car.</p>
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
                  Join <strong>{directApSsid}</strong>
                  <br />
                  <code className="conn-code">{AP_PASS}</code>
                </p>
                <button
                  type="button"
                  onClick={onRetryDirect}
                  className="conn-btn conn-btn-primary"
                >
                  I’m connected
                </button>
              </section>
            </div>

            <p className="conn-foot">
              Ignore “no internet”. Check{" "}
              <a className="conn-link" href={`http://${AP_IP}/`} target="_blank" rel="noreferrer">
                {AP_IP}
              </a>
            </p>
          </div>
        )}

        {(phase === "setup" || phase === "connecting_sta") && (
          <div className="conn-block conn-stack">
            <p className="conn-lead">Home Wi‑Fi for the car</p>
            <p className="conn-copy">
              Stay on <strong>{directApSsid}</strong>, then enter your router name and password.
              The car joins that network (phone stays on the hotspot until you switch).
            </p>
            <label className="conn-label">
              Network name
              <input
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                disabled={busy || phase === "connecting_sta"}
                className="conn-input"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
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
                autoComplete="current-password"
              />
            </label>
            <button
              type="button"
              disabled={!ssid.trim() || busy || phase === "connecting_sta"}
              onClick={() => void onConnect()}
              className="conn-btn conn-btn-primary"
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
            <button type="button" onClick={onRetry} className="conn-btn conn-btn-primary">
              Reconnect
            </button>
            <button type="button" onClick={onRetryDirect} className="conn-btn">
              Stay on {directApSsid}
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
              Tap Drive — no notification. Wheel and pedals talk to the car over Wi‑Fi.
            </p>

            <button type="button" onClick={onClose} className="conn-btn conn-btn-primary">
              Drive
            </button>

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

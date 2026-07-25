"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AnalogCluster } from "@/components/AnalogCluster";
import { CameraView } from "@/components/CameraView";
import {
  LinkSettingsModal,
  type CarStatus,
} from "@/components/LinkSettingsModal";
import { MotorPanel } from "@/components/MotorPanel";
import { SignalBars } from "@/components/SignalBars";
import { SteeringWheel } from "@/components/SteeringWheel";
import { useCarSocket } from "@/hooks/useCarSocket";
import {
  AP_HOST,
  AP_SSID,
  DEFAULT_WS_URL,
  MOTOR_MAX,
  SERVO_CENTER,
  hostToHttpBase,
  hostToWsUrl,
  loadCarHost,
  loadLinkMode,
  loadStoredWsUrl,
  rssiToBars,
  saveCarHost,
  saveLinkMode,
  saveStoredWsUrl,
  upsertSavedNetwork,
  wheelDegToServo,
  type LinkMode,
} from "@/lib/protocol";

export function Cockpit() {
  const [debug, setDebug] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<LinkMode>("hotspot");
  const [host, setHost] = useState("");
  const [wsUrl, setWsUrl] = useState("");
  const [linkEnabled, setLinkEnabled] = useState(false);
  const [carStatus, setCarStatus] = useState<CarStatus | null>(null);
  const [wheelDeg, setWheelDeg] = useState(0);
  const [servoAngle, setServoAngle] = useState(SERVO_CENTER);
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  const [lightsOn, setLightsOn] = useState(false);
  const [gear, setGear] = useState<"D" | "R">("D");
  const [batteryPct, setBatteryPct] = useState(100);
  const [usbPower, setUsbPower] = useState(false);
  const [charging, setCharging] = useState(false);
  const [chargeFull, setChargeFull] = useState(false);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const m = loadLinkMode();
    const h = loadCarHost();
    const stored = loadStoredWsUrl();
    setMode(m);
    setHost(h);
    if (stored) {
      setWsUrl(stored);
      setLinkEnabled(true);
    }
  }, []);

  const {
    state: wsState,
    lastAck,
    telemetry,
    sendSteer,
    sendCenter,
    sendDrive: sendDriveWs,
    sendStop: sendStopWs,
    sendLights: sendLightsWs,
  } = useCarSocket({
    url: wsUrl || DEFAULT_WS_URL,
    enabled: linkEnabled && Boolean(wsUrl),
  });

  const linked = wsState === "open";
  const canDrive = linked;
  const statusHost =
    mode === "hotspot" ? AP_HOST : host || wsUrl.replace(/^ws:\/\//, "").replace(/:81$/, "");
  const httpBase = hostToHttpBase(statusHost);
  const streamUrl =
    mode === "home" && carStatus?.ip
      ? `http://${carStatus.ip}/jpg`
      : `${httpBase}/jpg`;

  const activeRssi =
    mode === "hotspot" ? carStatus?.apRssi : carStatus?.rssi;
  const signalBars = rssiToBars(activeRssi, linked);

  const refreshStatus = useEffectEvent(async () => {
    try {
      const res = await fetch(`${hostToHttpBase(statusHost)}/status?t=${Date.now()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) return;
      const j = (await res.json()) as CarStatus;
      setCarStatus(j);
      if (typeof j.batt === "number") {
        setBatteryPct(Math.max(0, Math.min(100, Math.round(j.batt))));
      }
      if (typeof j.usb === "boolean") setUsbPower(j.usb);
      if (typeof j.charging === "boolean") setCharging(j.charging);
      if (typeof j.full === "boolean") setChargeFull(j.full);
    } catch {
      /* stay with last status — WS still drives */
    }
  });

  useEffect(() => {
    if (!linkEnabled) return;
    void refreshStatus();
    const id = setInterval(() => void refreshStatus(), linked ? 4000 : 7000);
    return () => clearInterval(id);
  }, [linkEnabled, linked, statusHost, refreshStatus]);

  useEffect(() => {
    if (typeof telemetry.batt === "number") {
      setBatteryPct(Math.max(0, Math.min(100, Math.round(telemetry.batt))));
    }
    if (typeof telemetry.usb === "boolean") setUsbPower(telemetry.usb);
    if (typeof telemetry.charging === "boolean") setCharging(telemetry.charging);
    if (typeof telemetry.full === "boolean") setChargeFull(telemetry.full);
  }, [telemetry]);

  const connectHotspot = () => {
    const url = DEFAULT_WS_URL;
    setMode("hotspot");
    saveLinkMode("hotspot");
    setWsUrl(url);
    saveStoredWsUrl(url);
    setLinkEnabled(true);
    upsertSavedNetwork({
      mode: "hotspot",
      host: AP_HOST,
      label: AP_SSID,
      ssid: AP_SSID,
    });
    void refreshStatus();
  };

  const connectHome = (h: string) => {
    const url = hostToWsUrl(h);
    setMode("home");
    saveLinkMode("home");
    setHost(h);
    saveCarHost(h);
    setWsUrl(url);
    saveStoredWsUrl(url);
    setLinkEnabled(true);
    upsertSavedNetwork({
      mode: "home",
      host: h,
      label: carStatus?.ssid || h,
      ssid: carStatus?.ssid,
    });
  };

  const disconnect = () => {
    setLinkEnabled(false);
  };

  const sendDrive = (l: number, r: number) => {
    setLeft(l);
    setRight(r);
    sendDriveWs(l, r);
  };

  const sendStop = () => {
    setLeft(0);
    setRight(0);
    setWheelDeg(0);
    setServoAngle(SERVO_CENTER);
    sendStopWs();
  };

  const toggleLights = () => {
    const next = !lightsOn;
    setLightsOn(next);
    sendLightsWs(next);
  };

  const applyWheel = (deg: number) => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    setWheelDeg(deg);
    const angle = wheelDegToServo(deg);
    setServoAngle(angle);
    sendSteer(angle);
  };

  const autoCenter = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const start = wheelDeg;
    const t0 = performance.now();
    const duration = 280;

    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - (1 - t) ** 3;
      const deg = start * (1 - eased);
      setWheelDeg(deg);
      const angle = wheelDegToServo(deg);
      setServoAngle(angle);
      sendSteer(angle);
      if (t < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        animRef.current = null;
        setWheelDeg(0);
        setServoAngle(SERVO_CENTER);
        sendCenter();
      }
    };
    animRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  const halt = useEffectEvent(() => {
    sendStop();
  });

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") halt();
    };
    window.addEventListener("blur", halt);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", halt);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [halt]);

  const speedKmh = Math.round(
    (Math.max(Math.abs(left), Math.abs(right)) / MOTOR_MAX) * 330,
  );
  const rpm =
    Math.round(
      (Math.max(Math.abs(left), Math.abs(right)) / MOTOR_MAX) * 7.5 * 10,
    ) / 10;

  const wifiLabel =
    mode === "hotspot"
      ? `Hotspot · ${AP_HOST}`
      : host
        ? `Wi‑Fi · ${host}`
        : wsUrl;

  return (
    <div className="cockpit cockpit-graph relative flex h-dvh max-h-dvh flex-col overflow-hidden text-white">
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-start px-3 pt-1.5 sm:px-4">
          <div className="brand-glass pointer-events-none flex items-center gap-2 px-2 py-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/rc.svg"
            alt=""
            className="brand-rc-logo h-7 w-auto sm:h-8"
            draggable={false}
          />
          <p className="brand-title font-[family-name:var(--font-display)] flex items-center gap-1.5 text-[11px] tracking-[0.14em] text-[var(--paint)] sm:text-xs">
            <span>GT2 RS</span>
            <SignalBars bars={signalBars} compact />
          </p>
        </div>
      </header>

      <LinkSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        mode={mode}
        host={host}
        wsState={wsState}
        linked={linked}
        carStatus={carStatus}
        signalBars={signalBars}
        debug={debug}
        onDebugChange={setDebug}
        onConnectHotspot={connectHotspot}
        onConnectHome={connectHome}
        onDisconnect={disconnect}
        onRefreshStatus={async () => {
          await refreshStatus();
        }}
      />

      <main className="cockpit-layout relative z-10 grid min-h-0 flex-1 gap-0 p-0">
        <section className="cockpit-windscreen flex min-h-0 items-stretch justify-center">
          <CameraView
            streamUrl={streamUrl}
            cameraEnabled={linked}
            debug={debug}
            left={left}
            right={right}
            wheelDeg={wheelDeg}
            linkState={wsState}
            mode={mode}
            wifiLabel={wifiLabel}
            lastAck={lastAck}
            onOpenLink={() => setSettingsOpen(true)}
          />

          <div className="cockpit-wheel">
            <span
              className={`steer-chip glass-chip wheel-steer-chip font-mono text-[10px] text-white/70 ${gear === "R" ? "is-reverse" : ""}`}
            >
              <span>{servoAngle}°</span>
              {gear === "R" ? (
                <span className="steer-chip-rev">REVERSE</span>
              ) : null}
            </span>
            <div className="wheel-row">
              <div className="wheel-lights">
                <button
                  type="button"
                  className={`lights-switch ${lightsOn ? "is-on" : ""}`}
                  onClick={toggleLights}
                  aria-pressed={lightsOn}
                  aria-label="Lights"
                >
                  <span className="lights-switch-track">
                    <span className="lights-switch-mark top">ON</span>
                    <span
                      className={`lights-switch-knob ${lightsOn ? "up" : "down"}`}
                    />
                    <span className="lights-switch-mark bot">OFF</span>
                  </span>
                </button>
              </div>
              <SteeringWheel
                wheelDeg={wheelDeg}
                onWheelDeg={applyWheel}
                onRelease={autoCenter}
              />
            </div>
          </div>

          <div className="cockpit-analog">
            <AnalogCluster
              speed={speedKmh}
              rpm={rpm}
              fuel={batteryPct}
              usb={usbPower}
              charging={charging}
              full={chargeFull}
            />
          </div>

          <div className="cockpit-pedals">
            <MotorPanel
              enabled={canDrive}
              gear={gear}
              onGearChange={setGear}
              onDrive={sendDrive}
              onStop={sendStop}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

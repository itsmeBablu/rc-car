"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AnalogCluster } from "@/components/AnalogCluster";
import { CameraView } from "@/components/CameraView";
import { ConnectionModal } from "@/components/ConnectionModal";
import { MotorPanel } from "@/components/MotorPanel";
import { SteeringWheel } from "@/components/SteeringWheel";
import { useCarConnection } from "@/hooks/useCarConnection";
import { useCarSocket } from "@/hooks/useCarSocket";
import { MOTOR_MAX, SERVO_CENTER, wheelDegToServo } from "@/lib/protocol";

export function Cockpit() {
  const conn = useCarConnection();
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  const ready = conn.phase === "ready";

  // Auto-open when we need the user; auto-close once linked
  useEffect(() => {
    if (conn.phase === "ready") {
      setSettingsOpen(false);
      return;
    }
    if (conn.phase !== "idle") {
      setSettingsOpen(true);
    }
  }, [conn.phase]);

  const {
    state: wsState,
    lastAck,
    sendSteer,
    sendCenter,
    sendDrive: sendDriveWs,
    sendStop: sendStopWs,
    sendLights: sendLightsWs,
  } = useCarSocket({
    url: conn.wsUrl || "ws://0.0.0.0:81",
    enabled: ready && Boolean(conn.wsUrl),
    onTelemetry: (msg) => {
      if (typeof msg.batt === "number") {
        setBatteryPct(Math.max(0, Math.min(100, Math.round(msg.batt))));
      }
      if (typeof msg.usb === "boolean") setUsbPower(msg.usb);
      if (typeof msg.charging === "boolean") setCharging(msg.charging);
      if (typeof msg.full === "boolean") setChargeFull(msg.full);
    },
  });

  const canDrive = ready && wsState === "open";

  const sendDrive = (l: number, r: number) => {
    setLeft(l);
    setRight(r);
    if (canDrive) sendDriveWs(l, r);
  };

  const sendStop = () => {
    setLeft(0);
    setRight(0);
    setWheelDeg(0);
    setServoAngle(SERVO_CENTER);
    if (canDrive) sendStopWs();
  };

  const toggleLights = () => {
    const next = !lightsOn;
    setLightsOn(next);
    if (canDrive) sendLightsWs(next);
  };

  const applyWheel = (deg: number) => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    setWheelDeg(deg);
    const angle = wheelDegToServo(deg);
    setServoAngle(angle);
    if (canDrive) sendSteer(angle);
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
      if (canDrive) sendSteer(angle);
      if (t < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        animRef.current = null;
        setWheelDeg(0);
        setServoAngle(SERVO_CENTER);
        if (canDrive) sendCenter();
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

  return (
    <div className="cockpit cockpit-graph relative flex h-dvh max-h-dvh flex-col overflow-hidden text-white">
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-start px-3 pt-2 sm:px-4">
        <div className="brand-glass pointer-events-none flex items-center gap-2.5 px-2.5 py-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/rc.svg"
            alt=""
            className="brand-rc-logo h-10 w-auto sm:h-11"
            draggable={false}
          />
          <p className="brand-title font-[family-name:var(--font-display)] text-sm tracking-[0.14em] text-[var(--paint)]">
            GT2 RS
          </p>
        </div>
      </header>

      <ConnectionModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        phase={conn.phase}
        linkPath={conn.linkPath}
        message={conn.message}
        error={conn.error}
        homeSsid={conn.homeSsid}
        setupApSsid={conn.setupApSsid}
        directApSsid={conn.directApSsid}
        espIp={conn.espIp}
        onRetry={() => void conn.probe()}
        onRetryDirect={() => void conn.probeDirect()}
        onOpenSetup={conn.openSetup}
        onSubmitWifi={conn.submitWifi}
        onDisconnect={conn.disconnect}
        onDisconnectCarHome={conn.disconnectCarHome}
        onForgetCarHome={conn.forgetCarHome}
        initialSsid={conn.homeSsid}
      />

      <main className="cockpit-layout relative z-10 grid min-h-0 flex-1 gap-0 p-0">
        <section className="cockpit-windscreen flex min-h-0 items-stretch justify-center">
          <CameraView
            streamUrl={conn.streamUrl}
            wifiReady={ready}
            left={left}
            right={right}
            wheelDeg={wheelDeg}
            linkState={wsState}
            wifiLabel={conn.linkLabel || conn.wsUrl || undefined}
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

"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AnalogCluster } from "@/components/AnalogCluster";
import { CameraView } from "@/components/CameraView";
import { LinkSettingsModal } from "@/components/LinkSettingsModal";
import { MotorPanel } from "@/components/MotorPanel";
import { SteeringWheel } from "@/components/SteeringWheel";
import { useBleProvision } from "@/hooks/useBleProvision";
import { useCarSocket } from "@/hooks/useCarSocket";
import {
  MOTOR_MAX,
  SERVO_CENTER,
  saveStoredWsUrl,
  wheelDegToServo,
} from "@/lib/protocol";

export function Cockpit() {
  const ble = useBleProvision();
  const [wsUrl, setWsUrl] = useState("");
  const [debug, setDebug] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wheelDeg, setWheelDeg] = useState(0);
  const [servoAngle, setServoAngle] = useState(SERVO_CENTER);
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  const [lightsOn, setLightsOn] = useState(false);
  const [gear, setGear] = useState<"D" | "R">("D");
  const [batteryPct, setBatteryPct] = useState(92);
  const animRef = useRef<number | null>(null);

  const wifiReady = ble.wifiStatus?.wifi === "connected";
  const bleReady = ble.bleState === "connected";
  const derivedWs =
    ble.wifiStatus?.ws ||
    (ble.wifiStatus?.ip ? `ws://${ble.wifiStatus.ip}:81` : "");
  const streamUrl =
    ble.wifiStatus?.stream ||
    (ble.wifiStatus?.ip ? `http://${ble.wifiStatus.ip}/stream` : null);

  const onWifiReady = useEffectEvent((url: string) => {
    saveStoredWsUrl(url);
    setWsUrl(url);
  });

  useEffect(() => {
    if (wifiReady && derivedWs && derivedWs !== wsUrl) {
      onWifiReady(derivedWs);
    }
  }, [wifiReady, derivedWs, wsUrl]);

  const {
    state: wsState,
    lastAck,
    sendSteer: sendSteerWs,
    sendCenter: sendCenterWs,
    sendDrive: sendDriveWs,
    sendStop: sendStopWs,
    sendLights: sendLightsWs,
  } = useCarSocket({
    url: wsUrl || "ws://0.0.0.0:81",
    enabled: Boolean(wsUrl) && wifiReady,
  });

  const transport: "wifi" | "ble" | "none" =
    wifiReady && wsState === "open" ? "wifi" : bleReady ? "ble" : "none";

  const canDrive = transport !== "none";

  const sendSteer = (angle: number) => {
    if (transport === "wifi") sendSteerWs(angle);
    else if (transport === "ble") ble.sendSteerBle(angle);
  };

  const sendCenter = () => {
    if (transport === "wifi") sendCenterWs();
    else if (transport === "ble") ble.sendCenterBle();
  };

  const sendDrive = (l: number, r: number) => {
    setLeft(l);
    setRight(r);
    if (transport === "wifi") sendDriveWs(l, r);
    else if (transport === "ble") ble.sendDriveBle(l, r);
  };

  const sendStop = () => {
    setLeft(0);
    setRight(0);
    setWheelDeg(0);
    setServoAngle(SERVO_CENTER);
    if (transport === "wifi") sendStopWs();
    else if (transport === "ble") ble.sendStopBle();
  };

  const toggleLights = () => {
    const next = !lightsOn;
    setLightsOn(next);
    if (transport === "wifi") sendLightsWs(next);
    else if (transport === "ble") ble.sendLightsBle(next);
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

  useEffect(() => {
    const moving = Math.abs(left) > 20 || Math.abs(right) > 20;
    if (!moving) return;
    // Drain at a fixed rate while motors are active (no sticky counter)
    const id = setInterval(() => {
      setBatteryPct((b) => Math.max(5, b - 0.15));
    }, 2000);
    return () => clearInterval(id);
  }, [left, right]);

  const speedKmh = Math.round(
    (Math.max(Math.abs(left), Math.abs(right)) / MOTOR_MAX) * 330,
  );
  const rpm = Math.round(
    (Math.max(Math.abs(left), Math.abs(right)) / MOTOR_MAX) * 7.5 * 10,
  ) / 10;

  const linkState =
    transport === "wifi"
      ? wsState
      : transport === "ble"
        ? "open"
        : ble.bleState === "connecting"
          ? "connecting"
          : "idle";

  return (
    <div className="cockpit cockpit-graph relative flex h-dvh max-h-dvh flex-col overflow-hidden text-white">
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center px-3 pt-1.5 sm:px-4">
        <p className="font-[family-name:var(--font-display)] text-sm tracking-[0.14em] text-[var(--paint)] drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
          GT2 RS
        </p>
      </header>

      <LinkSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        mounted={ble.mounted}
        supported={ble.supported}
        bleState={ble.bleState}
        error={ble.error}
        controlError={ble.controlError}
        wifiStatus={ble.wifiStatus}
        networks={ble.networks}
        transport={transport}
        debug={debug}
        onDebugChange={setDebug}
        lastAck={lastAck}
        onConnectBle={() => void ble.connect()}
        onScanWifi={ble.scanWifi}
        onProvisionWifi={ble.provisionWifi}
        onForgetWifi={ble.forgetWifi}
      />

      <main className="cockpit-layout relative z-10 grid min-h-0 flex-1 gap-0 p-0">
        {/* Fullscreen live feed — controls & gauges overlay */}
        <section className="cockpit-windscreen flex min-h-0 items-stretch justify-center">
          <CameraView
            streamUrl={streamUrl}
            wifiReady={wifiReady}
            servoAngle={servoAngle}
            gear={gear}
            debug={debug}
            left={left}
            right={right}
            linkState={linkState}
            transport={transport}
            wifiLabel={wifiReady ? ble.wifiStatus?.ws : undefined}
            onOpenLink={() => setSettingsOpen(true)}
          />

          <div className="cockpit-wheel">
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
                  <span className={`lights-switch-knob ${lightsOn ? "up" : "down"}`} />
                  <span className="lights-switch-mark bot">OFF</span>
                </span>
              </button>
            </div>
            <SteeringWheel
              wheelDeg={wheelDeg}
              onWheelDeg={applyWheel}
              onRelease={autoCenter}
              debug={debug}
            />
          </div>

          <div className="cockpit-analog">
            <AnalogCluster speed={speedKmh} rpm={rpm} fuel={batteryPct} />
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

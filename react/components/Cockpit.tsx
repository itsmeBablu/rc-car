"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { LinkSettingsModal } from "@/components/LinkSettingsModal";
import { MotorPanel } from "@/components/MotorPanel";
import { SteeringWheel } from "@/components/SteeringWheel";
import { useBleProvision } from "@/hooks/useBleProvision";
import { useCarSocket } from "@/hooks/useCarSocket";
import {
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
  const animRef = useRef<number | null>(null);

  const wifiReady = ble.wifiStatus?.wifi === "connected";
  const bleReady = ble.bleState === "connected";
  const derivedWs =
    ble.wifiStatus?.ws ||
    (ble.wifiStatus?.ip ? `ws://${ble.wifiStatus.ip}:81` : "");

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

  const linkLabel =
    transport === "wifi"
      ? wsUrl
      : transport === "ble"
        ? "bluetooth control"
        : "connect Bluetooth";

  const linkState =
    transport === "wifi"
      ? wsState
      : transport === "ble"
        ? "open"
        : ble.bleState === "connecting"
          ? "connecting"
          : "idle";

  return (
    <div className="cockpit flex min-h-dvh flex-col text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div>
          <p className="font-[family-name:var(--font-display)] text-2xl tracking-wide text-[var(--paint)] sm:text-3xl">
            RC-CAR
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--rim)]">
            Drive · steer
          </p>
        </div>
        <ConnectionStatus state={linkState} url={linkLabel} />
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="border border-white/25 px-3 py-1.5 text-xs text-white/75 hover:bg-white/5"
        >
          Link
        </button>
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

      <main className="grid flex-1 grid-cols-1 items-center gap-6 px-4 pb-8 sm:grid-cols-[1fr_1.1fr] sm:px-8 lg:grid-cols-[1fr_1.1fr_0.95fr]">
        <section className="flex flex-col items-center justify-center">
          <SteeringWheel
            wheelDeg={wheelDeg}
            onWheelDeg={applyWheel}
            onRelease={autoCenter}
            debug={debug}
          />
          <p className="mt-3 text-center text-xs text-white/40">
            {transport === "ble" && "Bluetooth link"}
            {transport === "wifi" && "WiFi WebSocket"}
            {transport === "none" && "Open Link → Connect Bluetooth"}
          </p>
        </section>

        <section className="flex flex-col items-center justify-center gap-2 text-center">
          <div className="windscreen flex aspect-[16/10] w-full max-w-xl items-center justify-center">
            <div className="space-y-1">
              <p className="font-[family-name:var(--font-display)] text-4xl text-[var(--paint)]">
                {servoAngle}°
              </p>
              <p className="text-xs uppercase tracking-widest text-white/35">servo</p>
              {debug && (
                <p className="font-mono text-[11px] text-white/40">
                  L={left} R={right}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4 lg:w-full lg:justify-self-end">
          <MotorPanel enabled={canDrive} onDrive={sendDrive} onStop={sendStop} />
        </section>
      </main>
    </div>
  );
}

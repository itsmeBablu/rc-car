"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AnalogCluster } from "@/components/AnalogCluster";
import { CameraView } from "@/components/CameraView";
import { Glass } from "@/components/Glass";
import { HttpAccessBanner } from "@/components/HttpAccessBanner";
import {
  LinkSettingsModal,
} from "@/components/LinkSettingsModal";
import { MotorPanel } from "@/components/MotorPanel";
import { SignalBars } from "@/components/SignalBars";
import { SteeringWheel } from "@/components/SteeringWheel";
import { useCarSocket } from "@/hooks/useCarSocket";
import { useDrivePhysics } from "@/hooks/useDrivePhysics";
import type { DriveModeId } from "@/lib/drivePhysics";
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
  type CarStatus,
  type LinkMode,
} from "@/lib/protocol";
import { httpsBlocksLocalCar, probeCarHost, probeSoftAp } from "@/lib/linkNetwork";

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
  const [driveMode, setDriveMode] = useState<DriveModeId>("NORMAL");
  const [batteryPct, setBatteryPct] = useState(100);
  const [usbPower, setUsbPower] = useState(false);
  const [charging, setCharging] = useState(false);
  const [chargeFull, setChargeFull] = useState(false);
  const animRef = useRef<number | null>(null);
  const autoTried = useRef(false);

  const connectHotspot = useEffectEvent(() => {
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
  });

  const connectHome = useEffectEvent((h: string) => {
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
      label: h,
      ssid: undefined,
    });
  });

  useEffect(() => {
    const m = loadLinkMode();
    const h = loadCarHost();
    const stored = loadStoredWsUrl();
    setMode(m);
    setHost(h);
    if (stored) {
      setWsUrl(stored);
      setLinkEnabled(true);
      return;
    }

    // HTTP-only auto link: SoftAP first, then saved home IP
    if (httpsBlocksLocalCar() || autoTried.current) return;
    autoTried.current = true;
    void (async () => {
      const soft = await probeSoftAp();
      if (soft.ok) {
        if (soft.status) setCarStatus(soft.status);
        connectHotspot();
        return;
      }
      const homeHost = (h || "").trim();
      if (homeHost && homeHost !== AP_HOST) {
        const home = await probeCarHost(homeHost, 4000);
        if (home.ok) {
          if (home.status) setCarStatus(home.status);
          connectHome(home.status?.ip || homeHost);
        }
      }
    })();
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

  const leftRef = useRef(0);
  const rightRef = useRef(0);
  leftRef.current = left;
  rightRef.current = right;

  const {
    pedal: pedalInput,
    braking,
    output: driveOutput,
    setPedal,
    setBraking,
    hardStop,
  } = useDrivePhysics({
    mode: driveMode,
    gear,
    enabled: canDrive,
    onMotor: (l, r) => {
      leftRef.current = l;
      rightRef.current = r;
      setLeft(l);
      setRight(r);
      // drive 0,0 — do not use stop cmd (that also centers the wheel)
      sendDriveWs(l, r);
    },
  });

  // Keepalive: refresh drive cmds so ESP failsafe never leaves motors stuck on
  useEffect(() => {
    if (!linked) return;
    const id = setInterval(() => {
      sendDriveWs(leftRef.current, rightRef.current);
    }, 80);
    return () => clearInterval(id);
  }, [linked, sendDriveWs]);

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

  const disconnect = () => {
    setLinkEnabled(false);
  };

  const sendStop = () => {
    hardStop();
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
      <HttpAccessBanner />
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-start px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4">
        <div className="brand-liquid-wrap brand-liquid-wrap--footer pointer-events-none">
          <Glass borderRadius={10} zIndex={2} className="h-full w-full">
            <div className="lg-fill lg-fill-row gap-2 px-2.5 py-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/rc.svg"
                alt=""
                className="brand-rc-logo h-8 w-auto sm:h-9"
                draggable={false}
              />
              <p className="brand-title font-[family-name:var(--font-display)] flex items-center gap-1.5 text-xs tracking-[0.14em] text-[var(--paint)] sm:text-[13px]">
                <span>GT2 RS</span>
                <SignalBars bars={signalBars} compact />
              </p>
            </div>
          </Glass>
        </div>
      </footer>

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
        onCarStatus={(s) => {
          if (s) setCarStatus(s);
        }}
      />

      <main className="cockpit-layout relative z-10 grid min-h-0 flex-1 gap-0 p-0">
        <section className="cockpit-windscreen flex min-h-0 items-stretch justify-center">
          <CameraView
            streamUrl={streamUrl}
            cameraEnabled={linked}
            drivingActive={
              pedalInput > 0 || braking || Math.abs(left) > 0 || Math.abs(right) > 0
            }
            debug={debug}
            left={left}
            right={right}
            wheelDeg={wheelDeg}
            linkState={wsState}
            mode={mode}
            wifiLabel={wifiLabel}
            lastAck={lastAck}
            onOpenLink={() => setSettingsOpen(true)}
            linkExpanded={settingsOpen}
          />

          <div className="cockpit-wheel">
            <div className="steer-liquid-wrap wheel-steer-chip mb-1">
              <Glass borderRadius={999} zIndex={2} className="h-full w-full">
                <span
                  className={`lg-fill lg-fill-row justify-center gap-1 px-2 font-mono text-[10px] text-white/70 ${gear === "R" ? "is-reverse steer-chip" : "steer-chip"}`}
                >
                  <span>{servoAngle}°</span>
                  {gear === "R" ? (
                    <span className="steer-chip-rev">REVERSE</span>
                  ) : null}
                </span>
              </Glass>
            </div>
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
              linked={linked}
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
              driveMode={driveMode}
              onDriveModeChange={setDriveMode}
              pedalDown={pedalInput > 0}
              braking={braking}
              output={driveOutput}
              onPedal={(down) => setPedal(down ? 1 : 0)}
              onBrake={setBraking}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

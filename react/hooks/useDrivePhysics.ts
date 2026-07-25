"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  DrivePhysicsEngine,
  type DriveModeId,
  type PhysicsPhase,
} from "@/lib/drivePhysics";
import { MOTOR_MAX } from "@/lib/protocol";

type Gear = "D" | "R";

type Options = {
  mode: DriveModeId;
  gear: Gear;
  enabled: boolean;
  /** Eased motor command (signed PWM). */
  onMotor: (left: number, right: number) => void;
};

export function useDrivePhysics({ mode, gear, enabled, onMotor }: Options) {
  const engineRef = useRef<DrivePhysicsEngine | null>(null);
  if (!engineRef.current) engineRef.current = new DrivePhysicsEngine();

  const [pedal, setPedalState] = useState(0);
  const [braking, setBrakingState] = useState(false);
  const [output, setOutput] = useState(0);
  const [phase, setPhase] = useState<PhysicsPhase>("hold");

  const gearRef = useRef(gear);
  const enabledRef = useRef(enabled);
  const lastSentRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  gearRef.current = gear;
  enabledRef.current = enabled;

  const publish = useEffectEvent((magnitude: number, force = false) => {
    const mag = Math.round(clampMotor(magnitude) * MOTOR_MAX);
    if (!force && lastSentRef.current === mag) return;
    lastSentRef.current = mag;
    const signed = gearRef.current === "R" ? -mag : mag;
    onMotor(signed, signed);
    setOutput(magnitude);
  });

  const stopLoop = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const ensureLoop = useEffectEvent(() => {
    if (rafRef.current != null) return;
    const tick = (now: number) => {
      const eng = engineRef.current!;
      const mag = eng.tick(now);
      setPhase(eng.phase);
      setBrakingState(eng.braking);
      setPedalState(eng.pedal);
      publish(mag);

      const busy =
        eng.phase !== "hold" ||
        eng.pedal > 0 ||
        eng.braking ||
        eng.output > 0.0005;
      if (busy && enabledRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        if (eng.output <= 0.0005) {
          eng.output = 0;
          publish(0, true);
        }
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  });

  useEffect(() => {
    engineRef.current!.setMode(mode);
  }, [mode]);

  useEffect(() => {
    const eng = engineRef.current!;
    lastSentRef.current = null;
    publish(eng.output, true);
  }, [gear, publish]);

  useEffect(() => {
    if (enabled) return;
    const eng = engineRef.current!;
    eng.hardStop();
    setPedalState(0);
    setBrakingState(false);
    setPhase("hold");
    stopLoop();
    lastSentRef.current = null;
    publish(0, true);
  }, [enabled, publish]);

  useEffect(() => () => stopLoop(), []);

  const setPedal = (value: number) => {
    if (!enabledRef.current && value > 0) return;
    const eng = engineRef.current!;
    eng.setPedal(value);
    setPedalState(eng.pedal);
    setPhase(eng.phase);
    setBrakingState(eng.braking);
    ensureLoop();
  };

  const setBraking = (on: boolean) => {
    if (!enabledRef.current && on) return;
    const eng = engineRef.current!;
    eng.setBraking(on);
    setPedalState(eng.pedal);
    setBrakingState(eng.braking);
    setPhase(eng.phase);
    // Push first brake sample immediately so motors cut now
    publish(eng.tick(performance.now()), true);
    ensureLoop();
  };

  const hardStop = () => {
    const eng = engineRef.current!;
    eng.hardStop();
    setPedalState(0);
    setBrakingState(false);
    setPhase("hold");
    stopLoop();
    lastSentRef.current = null;
    publish(0, true);
  };

  return {
    pedal,
    braking,
    output,
    phase,
    setPedal,
    setBraking,
    hardStop,
  };
}

function clampMotor(m: number): number {
  return Math.max(0, Math.min(1, m));
}

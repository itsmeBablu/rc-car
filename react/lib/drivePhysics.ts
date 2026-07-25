/** Drive feel: pedal input ≠ motor output. Motors only get eased speed. */

export type DriveModeId = "NORMAL" | "SPORT";

export const DRIVE = {
  /** Pedal release: momentum coast-down. */
  COAST_DURATION_S: 1.8,
  /** Dedicated brake: firm pull to zero (much faster than coast). */
  BRAKE_DURATION_S: 0.25,
} as const;

/** Accel keyframes: [seconds, output 0..1] while pedal held at 100%. */
export const ACCEL_CURVES: Record<DriveModeId, readonly (readonly [number, number])[]> = {
  // 2s → 75%, 3.5s → 100%
  NORMAL: [
    [0, 0],
    [2, 0.75],
    [3.5, 1],
  ],
  // 1s → 70%, 2s → 90%, 3s → 100%
  SPORT: [
    [0, 0],
    [1, 0.7],
    [2, 0.9],
    [3, 1],
  ],
};

export type PhysicsPhase = "hold" | "accel" | "coast" | "brake";

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Ease-out cubic — coast decay toward 0. */
export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  const u = 1 - x;
  return 1 - u * u * u;
}

/** Near-linear firm brake. */
export function easeOutQuad(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Sample accel curve at elapsed seconds (pedal = 1). */
export function sampleAccelCurve(mode: DriveModeId, elapsedS: number): number {
  const kf = ACCEL_CURVES[mode];
  const t = Math.max(0, elapsedS);
  if (t <= kf[0][0]) return kf[0][1];
  const last = kf[kf.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < kf.length - 1; i++) {
    const [t0, v0] = kf[i];
    const [t1, v1] = kf[i + 1];
    if (t <= t1) {
      const u = (t - t0) / Math.max(1e-9, t1 - t0);
      return lerp(v0, v1, u);
    }
  }
  return last[1];
}

/** Inverse: earliest time on the curve that reaches `output` (0..1). */
export function timeAtAccelOutput(mode: DriveModeId, output: number): number {
  const y = clamp01(output);
  const kf = ACCEL_CURVES[mode];
  if (y <= kf[0][1]) return kf[0][0];
  const last = kf[kf.length - 1];
  if (y >= last[1]) return last[0];
  for (let i = 0; i < kf.length - 1; i++) {
    const [t0, v0] = kf[i];
    const [t1, v1] = kf[i + 1];
    if (y <= v1 + 1e-9) {
      if (y < v0 - 1e-9) continue;
      const u = (y - v0) / Math.max(1e-9, v1 - v0);
      return lerp(t0, t1, clamp01(u));
    }
  }
  return last[0];
}

export function accelDurationS(mode: DriveModeId): number {
  const kf = ACCEL_CURVES[mode];
  return kf[kf.length - 1][0];
}

/**
 * Mutable RAF-friendly engine.
 * `output` is always 0..1 magnitude; gear sign is applied by the caller.
 */
export class DrivePhysicsEngine {
  mode: DriveModeId = "NORMAL";
  /** Raw pedal 0..1 (finger). */
  pedal = 0;
  braking = false;
  /** Eased speed 0..1 sent toward motors. */
  output = 0;
  phase: PhysicsPhase = "hold";

  private from = 0;
  private to = 0;
  private startedAt = 0;
  private durationS = 0;
  private ease: (t: number) => number = easeOutCubic;
  /** Mode locked when the current accel phase began. */
  private phaseMode: DriveModeId = "NORMAL";
  /** Wall-clock origin so elapsed maps onto the accel keyframe curve. */
  private accelEpochMs = 0;

  setMode(mode: DriveModeId) {
    this.mode = mode;
  }

  setPedal(value: number) {
    const next = clamp01(value);
    if (next === this.pedal) return;
    this.pedal = next;
    // Don't fight an active brake with a new throttle press until brake lifts
    if (this.braking && next > 0) return;
    this.syncPhase(performance.now());
  }

  setBraking(on: boolean) {
    if (on === this.braking) return;
    this.braking = on;
    if (on) {
      // Brake overrides throttle — cut pedal intent so we don't re-accel mid-brake
      this.pedal = 0;
      this.startBlend(
        performance.now(),
        0,
        DRIVE.BRAKE_DURATION_S,
        easeOutQuad,
        "brake",
      );
      return;
    }
    this.syncPhase(performance.now());
  }

  /** Instant cut — blur / disconnect / emergency. */
  hardStop() {
    this.pedal = 0;
    this.braking = false;
    this.output = 0;
    this.phase = "hold";
    this.from = 0;
    this.to = 0;
  }

  /** Advance simulation; returns eased magnitude 0..1. */
  tick(now = performance.now()): number {
    if (this.phase === "hold") {
      return this.output;
    }

    if (this.phase === "accel" && this.pedal > 0 && !this.braking) {
      const elapsedS = (now - this.accelEpochMs) / 1000;
      const curve = sampleAccelCurve(this.phaseMode, elapsedS);
      this.output = curve * this.pedal;
      if (elapsedS >= accelDurationS(this.phaseMode)) {
        this.output = this.pedal;
        this.phase = "hold";
      }
      return this.output;
    }

    // Coast / brake
    const durMs = Math.max(1, this.durationS * 1000);
    const t = clamp01((now - this.startedAt) / durMs);
    this.output = this.from + (this.to - this.from) * this.ease(t);
    if (t >= 1) {
      this.output = this.to;
      this.phase = "hold";
      if (this.pedal > 0 && !this.braking) {
        this.syncPhase(now);
      }
    }
    return this.output;
  }

  private syncPhase(now: number) {
    if (this.braking) {
      this.startBlend(now, 0, DRIVE.BRAKE_DURATION_S, easeOutQuad, "brake");
      return;
    }

    if (this.pedal <= 0) {
      if (this.output <= 0.0005) {
        this.output = 0;
        this.phase = "hold";
        return;
      }
      this.startBlend(now, 0, DRIVE.COAST_DURATION_S, easeOutCubic, "coast");
      return;
    }

    // Throttle — selected mode's keyframe curve for this press
    this.phaseMode = this.mode;
    const target = this.pedal;
    if (this.output >= target - 0.0005) {
      this.output = target;
      this.phase = "hold";
      return;
    }

    const along = clamp01(this.output / Math.max(target, 1e-6));
    const tStart = timeAtAccelOutput(this.phaseMode, along);
    this.accelEpochMs = now - tStart * 1000;
    this.phase = "accel";
  }

  private startBlend(
    now: number,
    to: number,
    durationS: number,
    ease: (t: number) => number,
    phase: PhysicsPhase,
  ) {
    this.phase = phase;
    this.from = this.output;
    this.to = to;
    this.startedAt = now;
    this.durationS = durationS;
    this.ease = ease;
  }
}

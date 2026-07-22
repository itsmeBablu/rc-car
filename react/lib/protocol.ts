export const DEFAULT_WS_URL = "";
export const WS_URL_STORAGE_KEY = "rc-car-ws-url";

export function loadStoredWsUrl(): string {
  if (typeof window === "undefined") return DEFAULT_WS_URL;
  return localStorage.getItem(WS_URL_STORAGE_KEY) || DEFAULT_WS_URL;
}

export function saveStoredWsUrl(url: string) {
  localStorage.setItem(WS_URL_STORAGE_KEY, url);
}

export const SERVO_MIN = 0;
export const SERVO_MAX = 180;
export const SERVO_CENTER = 90;

export const MOTOR_MAX = 255;

/** Wheel lock-to-lock: 2.5 turns = 900° of wheel rotation → 0–180° servo */
export const WHEEL_LOCK_TO_LOCK_DEG = 900;

export function wheelDegToServo(wheelDeg: number): number {
  const half = WHEEL_LOCK_TO_LOCK_DEG / 2;
  const clamped = Math.max(-half, Math.min(half, wheelDeg));
  const t = (clamped + half) / WHEEL_LOCK_TO_LOCK_DEG;
  return Math.round(SERVO_MIN + t * (SERVO_MAX - SERVO_MIN));
}

export function steerMessage(angle: number): string {
  return JSON.stringify({ cmd: "steer", angle });
}

export function centerMessage(): string {
  return JSON.stringify({ cmd: "center" });
}

export function driveMessage(left: number, right: number): string {
  return JSON.stringify({
    cmd: "drive",
    left: Math.round(left),
    right: Math.round(right),
  });
}

export function stopMessage(): string {
  return JSON.stringify({ cmd: "stop" });
}

export function lightsMessage(on: boolean): string {
  return JSON.stringify({ cmd: "lights", on });
}

export function pingMessage(): string {
  return JSON.stringify({ cmd: "ping" });
}

export function modeMessage(mode: "NORMAL" | "SPORT" | "CRAWL"): string {
  return JSON.stringify({ mode });
}

export const DRIVE_MODE_KEY = "rc-car-drive-mode";

export function loadDriveMode(): "NORMAL" | "SPORT" | "CRAWL" {
  if (typeof window === "undefined") return "NORMAL";
  const v = localStorage.getItem(DRIVE_MODE_KEY);
  if (v === "SPORT" || v === "CRAWL" || v === "NORMAL") return v;
  return "NORMAL";
}

export function saveDriveMode(mode: "NORMAL" | "SPORT" | "CRAWL") {
  localStorage.setItem(DRIVE_MODE_KEY, mode);
}

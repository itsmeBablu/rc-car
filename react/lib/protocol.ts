export const DEFAULT_WS_URL = "ws://192.168.4.1:81";
export const WS_URL_STORAGE_KEY = "rc-car-ws-url";
export const LINK_MODE_KEY = "rc-car-link-mode";
export const CAR_HOST_KEY = "rc-car-host";

export type LinkMode = "hotspot" | "home";

export const AP_SSID = "Porsche_RC_Car";
export const AP_PASS = "12345678";
export const AP_HOST = "192.168.4.1";

export function loadStoredWsUrl(): string {
  if (typeof window === "undefined") return DEFAULT_WS_URL;
  return localStorage.getItem(WS_URL_STORAGE_KEY) || DEFAULT_WS_URL;
}

export function saveStoredWsUrl(url: string) {
  localStorage.setItem(WS_URL_STORAGE_KEY, url);
}

export function loadLinkMode(): LinkMode {
  if (typeof window === "undefined") return "hotspot";
  return localStorage.getItem(LINK_MODE_KEY) === "home" ? "home" : "hotspot";
}

export function saveLinkMode(mode: LinkMode) {
  localStorage.setItem(LINK_MODE_KEY, mode);
}

export function loadCarHost(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(CAR_HOST_KEY) || "";
}

export function saveCarHost(host: string) {
  localStorage.setItem(CAR_HOST_KEY, host);
}

export function hostToWsUrl(host: string): string {
  const h = host.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!h) return DEFAULT_WS_URL;
  if (h.startsWith("ws://") || h.startsWith("wss://")) return h;
  return `ws://${h.replace(/:81$/, "")}:81`;
}

export function hostToHttpBase(host: string): string {
  const h = host.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!h) return `http://${AP_HOST}`;
  if (h.startsWith("ws://")) return `http://${h.slice(5).replace(/:81$/, "")}`;
  if (h.startsWith("wss://")) return `https://${h.slice(6).replace(/:81$/, "")}`;
  return `http://${h.replace(/:81$/, "")}`;
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

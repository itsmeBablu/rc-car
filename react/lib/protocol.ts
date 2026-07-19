export const DEFAULT_WS_URL = "";
export const WS_URL_STORAGE_KEY = "rc-car-ws-url";
export const PREFER_BLE_KEY = "rc-car-prefer-ble";
export const WIFI_SSID_KEY = "rc-car-wifi-ssid";
export const WIFI_PASS_KEY = "rc-car-wifi-pass";

export function loadStoredWsUrl(): string {
  if (typeof window === "undefined") return DEFAULT_WS_URL;
  return localStorage.getItem(WS_URL_STORAGE_KEY) || DEFAULT_WS_URL;
}

export function saveStoredWsUrl(url: string) {
  localStorage.setItem(WS_URL_STORAGE_KEY, url);
}

/** Default true — drive over Bluetooth (works with no WiFi / camera optional). */
export function loadPreferBle(): boolean {
  if (typeof window === "undefined") return true;
  const v = localStorage.getItem(PREFER_BLE_KEY);
  if (v === null) return true;
  return v !== "0";
}

export function savePreferBle(prefer: boolean) {
  localStorage.setItem(PREFER_BLE_KEY, prefer ? "1" : "0");
}

export function loadStoredWifiCreds(): { ssid: string; password: string } | null {
  if (typeof window === "undefined") return null;
  const ssid = localStorage.getItem(WIFI_SSID_KEY) || "";
  if (!ssid) return null;
  return { ssid, password: localStorage.getItem(WIFI_PASS_KEY) || "" };
}

export function saveStoredWifiCreds(ssid: string, password: string) {
  localStorage.setItem(WIFI_SSID_KEY, ssid);
  localStorage.setItem(WIFI_PASS_KEY, password);
}

export function clearStoredWifiCreds() {
  localStorage.removeItem(WIFI_SSID_KEY);
  localStorage.removeItem(WIFI_PASS_KEY);
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

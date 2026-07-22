/** HTTP helpers — Home / Direct / Setup (Wi‑Fi only, no BLE). */

export const SETUP_AP_SSID = "Porsche_RC_Car";
export const DIRECT_AP_SSID = "Porsche_RC_Car";
export const AP_PASS = "12345678";
export const AP_IP = "192.168.4.1";
export const ESP_IP_KEY = "rc-car-esp-ip";
export const HOME_SSID_KEY = "rc-car-home-ssid";

export type CarStatus = {
  mode?: "home" | "direct" | "setup";
  status?: string;
  wifi?: string;
  message?: string;
  ip?: string;
  ssid?: string;
  ap?: boolean;
  apSsid?: string;
  apIp?: string;
  ws?: string;
  stream?: string;
  jpg?: string;
  battery?: string;
  error?: string;
  attempt?: number;
};

export function loadEspIp(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ESP_IP_KEY) || "";
}

export function saveEspIp(ip: string) {
  localStorage.setItem(ESP_IP_KEY, ip);
}

export function loadHomeSsid(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(HOME_SSID_KEY) || "";
}

export function saveHomeSsid(ssid: string) {
  localStorage.setItem(HOME_SSID_KEY, ssid);
}

export function statusUrl(ip: string) {
  return `http://${ip}/api/status`;
}

export function wifiProvisionUrl(ip: string) {
  return `http://${ip}/api/wifi`;
}

export async function fetchCarStatus(
  ip: string,
  timeoutMs = 2500,
): Promise<CarStatus | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(statusUrl(ip), {
      method: "GET",
      signal: ctrl.signal,
      cache: "no-store",
      mode: "cors",
    });
    if (!res.ok) return null;
    return (await res.json()) as CarStatus;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Probe SoftAP repeatedly — DHCP often needs a few seconds after join. */
export async function fetchCarStatusRetry(
  ip: string,
  opts?: { attempts?: number; timeoutMs?: number; gapMs?: number },
): Promise<CarStatus | null> {
  const attempts = opts?.attempts ?? 8;
  const timeoutMs = opts?.timeoutMs ?? 2000;
  const gapMs = opts?.gapMs ?? 700;
  for (let i = 0; i < attempts; i++) {
    const s = await fetchCarStatus(ip, timeoutMs);
    if (s) return s;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }
  return null;
}

export async function provisionWifi(
  ip: string,
  ssid: string,
  password: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const res = await fetch(wifiProvisionUrl(ip), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ssid, password }),
  });
  return (await res.json()) as { ok: boolean; message?: string; error?: string };
}

export async function carWifiCmd(
  ip: string,
  cmd: "disconnect" | "forget",
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const res = await fetch(wifiProvisionUrl(ip), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd }),
  });
  return (await res.json()) as { ok: boolean; message?: string; error?: string };
}

export function wsUrlFromIp(ip: string) {
  return `ws://${ip}:81`;
}

export function streamUrlFromIp(ip: string) {
  return `http://${ip}/jpg`;
}

export function isDirectSoftAp(s: CarStatus | null): boolean {
  if (!s) return false;
  if (s.mode === "direct") return true;
  if (s.wifi === "direct") return true;
  if (s.apSsid === DIRECT_AP_SSID) return true;
  return false;
}

export function isDriveReadyStatus(s: CarStatus | null): boolean {
  if (!s) return false;
  if (isDirectSoftAp(s)) return true;
  if (s.mode === "home" && s.status === "connected" && s.ip) return true;
  return (s.status === "connected" || s.wifi === "connected") && Boolean(s.ip);
}

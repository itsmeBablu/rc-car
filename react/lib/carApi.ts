/** HTTP helpers — Home / Direct / Setup (Wi‑Fi only, no BLE). */

export const SETUP_AP_SSID = "Porsche_RC_Car";
export const DIRECT_AP_SSID = "Porsche_RC_Car";
export const AP_PASS = "12345678";
export const AP_IP = "192.168.4.1";
export const ESP_IP_KEY = "rc-car-esp-ip";
/** Home-router LAN IP of the car (never overwrite with SoftAP 192.168.4.1). */
export const HOME_LAN_IP_KEY = "rc-car-home-lan-ip";
export const HOME_SSID_KEY = "rc-car-home-ssid";
export const VIDEO_QUALITY_KEY = "rc-car-video-quality";
export const DEBUG_UI_KEY = "rc-car-debug-ui";

/** True when PWA is served over HTTPS (Vercel) — Safari blocks http:// car IPs. */
export function isHttpsApp(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:";
}

export function isLanIp(ip: string): boolean {
  if (!ip || ip === AP_IP) return false;
  // IPv4 private / link-local-ish for home routers
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

export function loadHomeLanIp(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(HOME_LAN_IP_KEY) || "";
}

export function saveHomeLanIp(ip: string) {
  if (!isLanIp(ip)) return;
  localStorage.setItem(HOME_LAN_IP_KEY, ip);
}

export function rememberCarIps(s: CarStatus | null) {
  if (!s) return;
  const sta = s.staIp || (s.ip && s.ip !== AP_IP ? s.ip : "");
  if (sta) saveHomeLanIp(sta);
}

export type VideoQuality = "auto" | "low" | "medium" | "high";

export const VIDEO_QUALITY_OPTIONS: {
  id: VideoQuality;
  label: string;
  hint: string;
  /** Client poll interval (ms). ESP may drop frames faster. */
  pollMs: number;
}[] = [
  { id: "auto", label: "Auto", hint: "Drops FPS under load", pollMs: 200 },
  { id: "low", label: "Low", hint: "Smallest / fastest", pollMs: 280 },
  { id: "medium", label: "Medium", hint: "Balanced", pollMs: 180 },
  { id: "high", label: "High", hint: "Best picture", pollMs: 120 },
];

export function loadVideoQuality(): VideoQuality {
  if (typeof window === "undefined") return "auto";
  const v = localStorage.getItem(VIDEO_QUALITY_KEY);
  if (v === "low" || v === "medium" || v === "high" || v === "auto") return v;
  return "auto";
}

export function saveVideoQuality(q: VideoQuality) {
  localStorage.setItem(VIDEO_QUALITY_KEY, q);
}

export function videoPollMs(q: VideoQuality): number {
  return VIDEO_QUALITY_OPTIONS.find((o) => o.id === q)?.pollMs ?? 200;
}

export function loadDebugUi(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEBUG_UI_KEY) === "1";
}

export function saveDebugUi(on: boolean) {
  localStorage.setItem(DEBUG_UI_KEY, on ? "1" : "0");
}

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
  /** STA / home-router address when AP_STA */
  staIp?: string;
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

export function pingUrl(ip: string) {
  return `http://${ip}/api/ping`;
}

/** Same-origin Next proxy — works when browser blocks direct SoftAP fetch. */
export function carProxyStatusUrl(ip: string) {
  return `/api/car/api/status?ip=${encodeURIComponent(ip)}`;
}

export function carProxyPingUrl(ip: string) {
  return `/api/car/api/ping?ip=${encodeURIComponent(ip)}`;
}

export function wifiProvisionUrl(ip: string) {
  return `http://${ip}/api/wifi`;
}

export function videoApiUrl(ip: string) {
  return `http://${ip}/api/video`;
}

export async function setCarVideoQuality(
  ip: string,
  quality: VideoQuality,
): Promise<{ ok?: boolean; quality?: string; effective?: string; intervalMs?: number; error?: string }> {
  const res = await fetch(videoApiUrl(ip), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quality }),
  });
  return (await res.json()) as {
    ok?: boolean;
    quality?: string;
    effective?: string;
    intervalMs?: number;
    error?: string;
  };
}

export async function fetchCarStatus(
  ip: string,
  timeoutMs = 2500,
): Promise<CarStatus | null> {
  const tryOnce = async (url: string): Promise<CarStatus | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: ctrl.signal,
        cache: "no-store",
        mode: "cors",
        credentials: "omit",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as CarStatus & { ok?: boolean; error?: string };
      if (data && (data as { error?: string }).error && !(data.ap || data.ip || data.mode)) {
        return null;
      }
      return data;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  // 1) Direct SoftAP / LAN (works on http://localhost when CORS ok)
  const direct = await tryOnce(statusUrl(ip));
  if (direct) return direct;

  // 2) Tiny ping then status again
  await tryOnce(pingUrl(ip));
  const again = await tryOnce(statusUrl(ip));
  if (again) return again;

  // 3) Same-origin Next.js proxy (Node on the PC talks to SoftAP)
  if (typeof window !== "undefined" && !isHttpsApp()) {
    const viaProxy = await tryOnce(carProxyStatusUrl(ip));
    if (viaProxy) return viaProxy;
  }

  return null;
}

/** Probe SoftAP repeatedly — DHCP often needs a few seconds after join. */
export async function fetchCarStatusRetry(
  ip: string,
  opts?: { attempts?: number; timeoutMs?: number; gapMs?: number },
): Promise<CarStatus | null> {
  const attempts = opts?.attempts ?? 8;
  const timeoutMs = opts?.timeoutMs ?? 3000;
  const gapMs = opts?.gapMs ?? 500;
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
  // Any reachable SoftAP / drive-ready payload
  if (s.ap || s.apIp || isDirectSoftAp(s)) return true;
  if (s.mode === "home" && (s.status === "connected" || s.wifi === "connected")) {
    return Boolean(s.ip || s.staIp);
  }
  if (s.status === "connected" || s.wifi === "connected" || s.wifi === "direct") {
    return Boolean(s.ip || s.staIp || s.apIp);
  }
  // Status endpoint answered — treat as reachable for Try IP
  if (s.ip || s.staIp || s.ws) return true;
  return false;
}

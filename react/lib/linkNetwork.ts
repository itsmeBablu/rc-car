import { AP_HOST, AP_SSID, hostToHttpBase, type CarStatus } from "@/lib/protocol";

export type NetKind = "wifi" | "cellular" | "ethernet" | "other" | "unknown";

export type ProbeResult = {
  ok: boolean;
  ms: number;
  status?: CarStatus;
  error?: string;
};

export function isHttpsApp(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:";
}

/** Browsers block ws:// / http:// to the car from an https:// app (mixed content). */
export function httpsBlocksLocalCar(): boolean {
  return isHttpsApp();
}

/** True when launched from “Add to Home Screen” (standalone PWA). */
export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const ios = "standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone;
  return Boolean(mq || ios);
}

export function getNetworkKind(): NetKind {
  if (typeof navigator === "undefined") return "unknown";
  const c =
    (
      navigator as Navigator & {
        connection?: { type?: string; effectiveType?: string };
        mozConnection?: { type?: string };
        webkitConnection?: { type?: string };
      }
    ).connection ||
    (navigator as Navigator & { mozConnection?: { type?: string } }).mozConnection ||
    (navigator as Navigator & { webkitConnection?: { type?: string } })
      .webkitConnection;
  const t = (c?.type || "").toLowerCase();
  if (t === "wifi") return "wifi";
  if (t === "cellular") return "cellular";
  if (t === "ethernet") return "ethernet";
  if (t) return "other";
  return "unknown";
}

export function networkKindLabel(kind: NetKind): string {
  switch (kind) {
    case "wifi":
      return "Wi‑Fi";
    case "cellular":
      return "Cellular";
    case "ethernet":
      return "Ethernet";
    case "other":
      return "Other";
    default:
      return "Unknown (browser can’t read SSID)";
  }
}

export function openDeviceWifiSettings(): { opened: boolean; hint: string } {
  if (typeof window === "undefined") {
    return { opened: false, hint: "Open Wi‑Fi in phone Settings." };
  }
  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  if (isAndroid) {
    window.location.href =
      "intent://settings/wifi#Intent;scheme=android-app;package=com.android.settings;end";
    setTimeout(() => {
      try {
        window.open("android.settings.WIFI_SETTINGS", "_blank");
      } catch {
        /* ignore */
      }
    }, 400);
    return {
      opened: true,
      hint: `Opening Wi‑Fi settings… Join “${AP_SSID}” / 12345678.`,
    };
  }

  if (isIOS) {
    try {
      window.location.href = "App-prefs:root=WIFI";
    } catch {
      /* ignore */
    }
    return {
      opened: false,
      hint: `iPhone: Settings → Wi‑Fi → “${AP_SSID}” / 12345678, then return.`,
    };
  }

  return {
    opened: false,
    hint: "Open system Wi‑Fi settings and join the car network.",
  };
}

export async function probeCarHost(
  host: string,
  timeoutMs = 3500,
): Promise<ProbeResult> {
  const t0 = performance.now();
  const base = hostToHttpBase(host);
  try {
    const res = await fetch(`${base}/status?t=${Date.now()}`, {
      cache: "no-store",
      mode: "cors",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      return { ok: false, ms, error: `HTTP ${res.status}` };
    }
    const status = (await res.json()) as CarStatus;
    return { ok: true, ms, status };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const msg = e instanceof Error ? e.message : String(e);
    const blocked =
      httpsBlocksLocalCar() &&
      (msg.includes("Failed to fetch") ||
        msg.includes("NetworkError") ||
        msg.includes("Load failed"));
    return {
      ok: false,
      ms,
      error: blocked
        ? `HTTPS/PWA blocked local fetch (${msg})`
        : msg,
    };
  }
}

export async function probeSoftAp(): Promise<ProbeResult> {
  return probeCarHost(AP_HOST);
}

export function softApGuessLabel(probe: ProbeResult | null): string {
  if (!probe) return "Not checked yet";
  if (probe.ok) {
    return `Car SoftAP reachable (${probe.ms} ms) — likely on “${AP_SSID}”`;
  }
  return `Car SoftAP not reachable — join “${AP_SSID}” first`;
}

export function openCarSoftApPage() {
  if (typeof window === "undefined") return;
  window.location.href = `http://${AP_HOST}/`;
}

export type LinkDebugSnapshot = {
  at: string;
  page: string;
  https: boolean;
  standalonePwa: boolean;
  httpsBlocksLocal: boolean;
  netKind: NetKind;
  wsState: string;
  linkMode: string;
  host: string;
  softProbe: ProbeResult | null;
  homeProbe?: ProbeResult | null;
  carStatus: CarStatus | null;
  log: string[];
  tip: string;
};

export function buildLinkDebugReport(s: LinkDebugSnapshot): string {
  const tip =
    s.tip ||
    (s.httpsBlocksLocal
      ? `HTTPS/PWA cannot open ws:// to the car. On SoftAP use http://${AP_HOST}/`
      : "If SoftAP probe fails: join Porsche_RC_Car first. If home fails: save Wi‑Fi on car, then use STA IP.");

  return [
    "=== GT2 RS Link Debug ===",
    `at: ${s.at}`,
    `page: ${s.page}`,
    `https: ${s.https}`,
    `standalonePwa: ${s.standalonePwa}`,
    `httpsBlocksLocal: ${s.httpsBlocksLocal}`,
    `netKind: ${s.netKind}`,
    `wsState: ${s.wsState}`,
    `linkMode: ${s.linkMode}`,
    `host: ${s.host}`,
    `softProbe: ${JSON.stringify(s.softProbe)}`,
    `homeProbe: ${JSON.stringify(s.homeProbe ?? null)}`,
    `carStatus: ${JSON.stringify(s.carStatus)}`,
    "--- log ---",
    ...s.log,
    "--- tip ---",
    tip,
    "=== end ===",
  ].join("\n");
}

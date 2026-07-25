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

export function getNetworkKind(): NetKind {
  if (typeof navigator === "undefined") return "unknown";
  const c = (
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

/** Open OS Wi‑Fi settings when the platform allows it. */
export function openDeviceWifiSettings(): { opened: boolean; hint: string } {
  if (typeof window === "undefined") {
    return { opened: false, hint: "Open Wi‑Fi in phone Settings." };
  }
  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  if (isAndroid) {
    // Prefer Settings intent — works from Chrome in many cases
    window.location.href =
      "intent://settings/wifi#Intent;scheme=android-app;package=com.android.settings;end";
    // Fallback shortly after if still on page
    setTimeout(() => {
      try {
        window.open("android.settings.WIFI_SETTINGS", "_blank");
      } catch {
        /* ignore */
      }
    }, 400);
    return {
      opened: true,
      hint: "Opening Android Wi‑Fi settings… Join “Porsche_RC_Car” / 12345678.",
    };
  }

  if (isIOS) {
    // iOS blocks most prefs URLs; App-prefs sometimes works on older iOS
    try {
      window.location.href = "App-prefs:root=WIFI";
    } catch {
      /* ignore */
    }
    return {
      opened: false,
      hint: "iPhone: open Settings → Wi‑Fi → join Porsche_RC_Car / 12345678, then return here.",
    };
  }

  return {
    opened: false,
    hint: "Open your system Wi‑Fi settings and join the car network.",
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
        ? `Blocked or unreachable from HTTPS (${msg})`
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
    return `Car SoftAP reachable (${probe.ms} ms) — phone is likely on “${AP_SSID}”`;
  }
  return `Car SoftAP not reachable — join “${AP_SSID}” first`;
}

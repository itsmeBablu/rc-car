"use client";

import { useEffect, useState } from "react";
import { isHttpsApp } from "@/lib/linkNetwork";

type LanInfo = { urls: string[]; ips: string[]; port: number };

/**
 * HTTP-only control: show phone URL when on localhost,
 * warn if somehow opened over HTTPS.
 */
export function HttpAccessBanner() {
  const [https, setHttps] = useState(false);
  const [lan, setLan] = useState<LanInfo | null>(null);
  const [host, setHost] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setHttps(isHttpsApp());
    setHost(window.location.hostname);
    if (isHttpsApp()) return;
    void fetch("/api/lan")
      .then((r) => r.json())
      .then((j: LanInfo) => setLan(j))
      .catch(() => {});
  }, []);

  if (dismissed) return null;

  if (https) {
    return (
      <div className="relative z-50 border-b border-amber-500/40 bg-amber-950/95 px-3 py-2 text-center text-[11px] leading-snug text-amber-100">
        You’re on the online (HTTPS) site — it can’t drive the car.
        <br />
        Use your React app from the PC instead: on the phone open{" "}
        <span className="font-mono text-[var(--paint)]">http://PC-IP:3000</span>{" "}
        (PC on, same Wi‑Fi). Or use the car’s own control page on home Wi‑Fi.
        <button
          type="button"
          className="ml-2 underline opacity-70"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    );
  }

  const onLocalhost = host === "localhost" || host === "127.0.0.1";
  const phoneUrl = lan?.urls?.[0];

  if (!onLocalhost || !phoneUrl) return null;

  return (
    <div className="relative z-50 border-b border-[var(--paint)]/30 bg-black/80 px-3 py-2 text-center text-[11px] text-white/80">
      On your phone open this same app at{" "}
      <a
        className="font-mono text-[var(--paint)] underline"
        href={phoneUrl}
        target="_blank"
        rel="noreferrer"
      >
        {phoneUrl}
      </a>{" "}
      (same Wi‑Fi). That is your React UI.
      <button
        type="button"
        className="ml-2 underline opacity-70"
        onClick={() => setDismissed(true)}
      >
        Dismiss
      </button>
    </div>
  );
}

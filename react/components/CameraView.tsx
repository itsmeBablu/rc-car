"use client";

import { useEffect, useRef, useState } from "react";
import { LinkDock } from "@/components/LinkDock";
import type { ConnectionState } from "@/hooks/useCarSocket";

type Props = {
  streamUrl: string | null;
  wifiReady: boolean;
  servoAngle: number;
  gear?: "D" | "R";
  debug?: boolean;
  left?: number;
  right?: number;
  linkState: ConnectionState;
  transport: "wifi" | "ble" | "none";
  wifiLabel?: string;
  onOpenLink: () => void;
};

function toJpgUrl(streamOrBase: string): string {
  try {
    const u = new URL(streamOrBase);
    u.pathname = "/jpg";
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return streamOrBase.replace(/\/stream\/?$/, "/jpg");
  }
}

export function CameraView({
  streamUrl,
  wifiReady,
  servoAngle,
  gear = "D",
  debug,
  left = 0,
  right = 0,
  linkState,
  transport,
  wifiLabel,
  onOpenLink,
}: Props) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const blobRef = useRef<string | null>(null);
  const okRef = useRef(false);

  const jpgBase = streamUrl ? toJpgUrl(streamUrl) : null;
  const canPoll = Boolean(wifiReady && jpgBase);

  useEffect(() => {
    if (!canPoll || !jpgBase) {
      setFrameUrl(null);
      setOk(false);
      okRef.current = false;
      setErr(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`${jpgBase}?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        if (blobRef.current) URL.revokeObjectURL(blobRef.current);
        blobRef.current = url;
        setFrameUrl(url);
        setErr(null);
        setOk(true);
        okRef.current = true;
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "fetch failed");
          if (!okRef.current) setOk(false);
        }
      }
      if (!cancelled) timer = setTimeout(tick, okRef.current ? 120 : 400);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, [canPoll, jpgBase]);

  return (
    <div className="windscreen glass-screen relative flex h-full min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
      {frameUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frameUrl}
          alt="Live camera"
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="z-10 space-y-1 px-4 text-center">
          <p className="font-[family-name:var(--font-display)] text-base tracking-wide text-white/50">
            {!wifiReady
              ? "Camera needs WiFi"
              : err
                ? "Camera offline"
                : "Starting camera…"}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-white/30">
            {err ?? (wifiReady ? "fetching…" : "join WiFi via Link")}
          </p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 px-3 pt-2">
        <span
          className={`steer-chip glass-chip font-mono text-[10px] text-white/70 ${gear === "R" ? "is-reverse" : ""}`}
        >
          <span>{servoAngle}°</span>
          {gear === "R" ? <span className="steer-chip-rev">REVERSE</span> : null}
        </span>
        <div className="pointer-events-auto">
          <LinkDock
            state={linkState}
            transport={transport}
            wifiLabel={wifiLabel}
            live={ok}
            onOpenLink={onOpenLink}
          />
        </div>
      </div>

      {debug && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-2">
          <span className="font-mono text-[9px] text-white/45">
            {jpgBase ?? "no-url"} · L={left} R={right}
          </span>
        </div>
      )}
    </div>
  );
}

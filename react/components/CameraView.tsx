"use client";

import { useEffect, useRef, useState } from "react";
import { LinkDock } from "@/components/LinkDock";
import type { ConnectionState } from "@/hooks/useCarSocket";

type Props = {
  streamUrl: string | null;
  wifiReady: boolean;
  pollMs?: number;
  debug?: boolean;
  left?: number;
  right?: number;
  wheelDeg?: number;
  linkState: ConnectionState;
  wifiLabel?: string;
  lastAck?: string | null;
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
  pollMs = 200,
  debug,
  left = 0,
  right = 0,
  wheelDeg = 0,
  linkState,
  wifiLabel,
  lastAck,
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
        if (res.status === 204) {
          // Frame dropped on ESP — drive wins; keep last image
          if (!cancelled) timer = setTimeout(tick, pollMs);
          return;
        }
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
      if (!cancelled) {
        timer = setTimeout(tick, okRef.current ? pollMs : Math.max(pollMs, 400));
      }
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
  }, [canPoll, jpgBase, pollMs]);

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
              ? "Connect to car"
              : err
                ? "Camera offline"
                : "Starting camera…"}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-white/30">
            {!wifiReady
              ? "Tap Link → Connect"
              : err
                ? err
                : "fetching…"}
          </p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-end gap-2 px-3 pt-2">
        <div className="pointer-events-auto link-stack">
          <LinkDock
            state={linkState}
            wifiLabel={wifiLabel}
            live={ok}
            onOpenLink={onOpenLink}
          />
          {debug ? (
            <div className="debug-glass w-full px-2.5 py-2 font-mono text-[9px] leading-relaxed text-white/70">
              <p className="text-[8px] uppercase tracking-wider text-white/40">
                Debug
              </p>
              <p>link=wifi</p>
              <p>ws={linkState}</p>
              <p>ack={lastAck ?? "—"}</p>
              <p>wheel={wheelDeg.toFixed(0)}°</p>
              <p>
                L={left} R={right}
              </p>
              <p className="truncate" title={jpgBase ?? undefined}>
                cam={ok ? "jpg" : "off"}
              </p>
              <p className="truncate text-white/45" title={jpgBase ?? undefined}>
                {jpgBase?.replace(/^https?:\/\//, "") ?? "no-url"}
              </p>
              {err ? <p className="text-amber-300/90">{err}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

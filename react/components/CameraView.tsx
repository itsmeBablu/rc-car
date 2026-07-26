"use client";

import { useEffect, useRef, useState } from "react";
import { Glass } from "@/components/Glass";
import { LinkDock } from "@/components/LinkDock";
import type { ConnectionState } from "@/hooks/useCarSocket";
import type { LinkMode } from "@/lib/protocol";

type Props = {
  streamUrl: string | null;
  cameraEnabled: boolean;
  /** True while throttle/brake/motors active — slow cam so controls stay first. */
  drivingActive?: boolean;
  debug?: boolean;
  left?: number;
  right?: number;
  wheelDeg?: number;
  linkState: ConnectionState;
  mode: LinkMode;
  wifiLabel?: string;
  lastAck?: string | null;
  onOpenLink: () => void;
  linkExpanded?: boolean;
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
  cameraEnabled,
  drivingActive = false,
  debug,
  left = 0,
  right = 0,
  wheelDeg = 0,
  linkState,
  mode,
  wifiLabel,
  lastAck,
  onOpenLink,
  linkExpanded = false,
}: Props) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const blobRef = useRef<string | null>(null);
  const okRef = useRef(false);
  const drivingRef = useRef(drivingActive);
  drivingRef.current = drivingActive;

  const jpgBase = streamUrl ? toJpgUrl(streamUrl) : null;
  const canPoll = Boolean(cameraEnabled && jpgBase);
  const linked = linkState === "open";

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
      const driving = drivingRef.current;
      // Camera last: pause while driving; idle = moderate refresh
      if (driving) {
        if (!cancelled) timer = setTimeout(tick, 700);
        return;
      }
      const gap = okRef.current ? 280 : 600;
      try {
        const res = await fetch(`${jpgBase}?t=${Date.now()}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(900),
        });
        if (!res.ok) {
          if (res.status === 503) {
            // ESP prioritizing control — try later
            if (!cancelled) timer = setTimeout(tick, 400);
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
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
        if (
          !cancelled &&
          !(e instanceof DOMException && e.name === "AbortError") &&
          !(e instanceof Error && e.name === "TimeoutError")
        ) {
          setErr(e instanceof Error ? e.message : "fetch failed");
          if (!okRef.current) setOk(false);
        }
      }
      if (!cancelled) timer = setTimeout(tick, gap);
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
            {!linked
              ? "Link to drive"
              : err
                ? "Camera offline"
                : "Camera warming up…"}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-white/30">
            {!linked
              ? "Hotspot or home Wi‑Fi"
              : err
                ? err
                : "low priority · drive first"}
          </p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-end gap-2 px-3 pt-2">
        <div className="pointer-events-auto link-stack">
          <LinkDock
            state={linkState}
            mode={mode}
            wifiLabel={wifiLabel}
            live={ok}
            expanded={linkExpanded}
            onOpenLink={onOpenLink}
          />
          {debug ? (
            <div className="debug-liquid-wrap w-full">
              <Glass borderRadius={14} zIndex={2} className="h-full w-full">
                <div className="px-2.5 py-2 font-mono text-[9px] leading-relaxed text-white/70">
                  <p className="text-[8px] uppercase tracking-wider text-white/40">
                    Debug
                  </p>
                  <p>mode={mode}</p>
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
              </Glass>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

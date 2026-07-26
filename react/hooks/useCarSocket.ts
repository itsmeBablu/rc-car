"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  centerMessage,
  DEFAULT_WS_URL,
  driveMessage,
  lightsMessage,
  pingMessage,
  steerMessage,
  stopMessage,
} from "@/lib/protocol";

export type ConnectionState = "idle" | "connecting" | "open" | "closed" | "error";

type Options = {
  url?: string;
  enabled?: boolean;
};

/**
 * Priority send path (never stuck on one message type):
 * 1) connection
 * 2) latest steer
 * 3) latest drive
 * 4) ping last
 */
export function useCarSocket(options: Options = {}) {
  const url = options.url ?? DEFAULT_WS_URL;
  const enabled = options.enabled ?? true;

  const [state, setState] = useState<ConnectionState>("idle");
  const [lastAck, setLastAck] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<{
    batt?: number;
    usb?: boolean;
    charging?: boolean;
    full?: boolean;
  }>({});
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const angleRef = useRef(90);
  const pendingSteer = useRef<number | null>(null);
  const pendingDrive = useRef<{ l: number; r: number } | null>(null);
  const flushRaf = useRef<number | null>(null);

  const clearRetry = () => {
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
  };

  const clearPing = () => {
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
  };

  const flush = useEffectEvent(() => {
    flushRaf.current = null;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Servo first, then motors — only latest of each
    const steer = pendingSteer.current;
    if (steer != null) {
      pendingSteer.current = null;
      angleRef.current = steer;
      ws.send(steerMessage(steer));
    }
    const drive = pendingDrive.current;
    if (drive) {
      pendingDrive.current = null;
      ws.send(driveMessage(drive.l, drive.r));
    }
  });

  const scheduleFlush = () => {
    if (flushRaf.current != null) return;
    flushRaf.current = requestAnimationFrame(() => flush());
  };

  const sendRaw = useEffectEvent((payload: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      return true;
    }
    return false;
  });

  const sendSteer = useEffectEvent((angle: number) => {
    pendingSteer.current = angle;
    scheduleFlush();
    return true;
  });

  const sendCenter = useEffectEvent(() => {
    pendingSteer.current = 90;
    angleRef.current = 90;
    scheduleFlush();
    return sendRaw(centerMessage());
  });

  const sendDrive = useEffectEvent((left: number, right: number) => {
    pendingDrive.current = { l: left, r: right };
    scheduleFlush();
    return true;
  });

  const sendStop = useEffectEvent(() => {
    pendingDrive.current = { l: 0, r: 0 };
    pendingSteer.current = 90;
    angleRef.current = 90;
    scheduleFlush();
    return sendRaw(stopMessage());
  });

  const sendLights = useEffectEvent((on: boolean) => {
    return sendRaw(lightsMessage(on));
  });

  const connect = useEffectEvent(() => {
    clearRetry();
    clearPing();
    if (flushRaf.current != null) {
      cancelAnimationFrame(flushRaf.current);
      flushRaf.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setState("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      setState("error");
      retryRef.current = setTimeout(() => connect(), 600);
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      setState("open");
      pendingSteer.current = angleRef.current;
      scheduleFlush();
      clearPing();
      // Ping last / rare — link keepalive only
      pingRef.current = setInterval(() => {
        sendRaw(pingMessage());
      }, 5000);
    };

    ws.onmessage = (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
      setLastAck(raw);
      try {
        const j = JSON.parse(raw) as {
          batt?: number;
          usb?: boolean;
          charging?: boolean;
          full?: boolean;
        };
        if (typeof j.batt === "number") {
          setTelemetry({
            batt: j.batt,
            usb: j.usb,
            charging: j.charging,
            full: j.full,
          });
        }
      } catch {
        /* ignore */
      }
    };

    ws.onerror = () => {
      setState("error");
    };

    ws.onclose = () => {
      clearPing();
      setState("closed");
      wsRef.current = null;
      retryRef.current = setTimeout(() => connect(), 600);
    };
  });

  useEffect(() => {
    if (!enabled) {
      clearRetry();
      clearPing();
      wsRef.current?.close();
      wsRef.current = null;
      setState("idle");
      return;
    }
    connect();
    return () => {
      clearRetry();
      clearPing();
      if (flushRaf.current != null) cancelAnimationFrame(flushRaf.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, url]);

  return {
    state,
    lastAck,
    telemetry,
    sendSteer,
    sendCenter,
    sendDrive,
    sendStop,
    sendLights,
  };
}

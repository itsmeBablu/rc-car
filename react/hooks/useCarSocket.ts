"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  centerMessage,
  DEFAULT_WS_URL,
  driveMessage,
  lightsMessage,
  steerMessage,
  stopMessage,
} from "@/lib/protocol";

export type ConnectionState = "idle" | "connecting" | "open" | "closed" | "error";

type Options = {
  url?: string;
  enabled?: boolean;
};

export function useCarSocket(options: Options = {}) {
  const url = options.url ?? DEFAULT_WS_URL;
  const enabled = options.enabled ?? true;

  const [state, setState] = useState<ConnectionState>("idle");
  const [lastAck, setLastAck] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const angleRef = useRef(90);

  const clearRetry = () => {
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
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
    angleRef.current = angle;
    return sendRaw(steerMessage(angle));
  });

  const sendCenter = useEffectEvent(() => {
    angleRef.current = 90;
    return sendRaw(centerMessage());
  });

  const sendDrive = useEffectEvent((left: number, right: number) => {
    return sendRaw(driveMessage(left, right));
  });

  const sendStop = useEffectEvent(() => {
    angleRef.current = 90;
    return sendRaw(stopMessage());
  });

  const sendLights = useEffectEvent((on: boolean) => {
    return sendRaw(lightsMessage(on));
  });

  const connect = useEffectEvent(() => {
    clearRetry();
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
      retryRef.current = setTimeout(() => connect(), 1500);
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      setState("open");
      sendSteer(angleRef.current);
    };

    ws.onmessage = (ev) => {
      setLastAck(typeof ev.data === "string" ? ev.data : String(ev.data));
    };

    ws.onerror = () => {
      setState("error");
    };

    ws.onclose = () => {
      setState("closed");
      wsRef.current = null;
      retryRef.current = setTimeout(() => connect(), 1500);
    };
  });

  useEffect(() => {
    if (!enabled) {
      clearRetry();
      wsRef.current?.close();
      wsRef.current = null;
      setState("idle");
      return;
    }
    connect();
    return () => {
      clearRetry();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, url]);

  return { state, lastAck, sendSteer, sendCenter, sendDrive, sendStop, sendLights };
}

"use client";

import { useEffect, useRef, useState } from "react";
import {
  connectBleDevice,
  isWebBluetoothAvailable,
  openBleSession,
  type WifiNetwork,
  type WifiStatus,
} from "@/lib/ble";
import {
  centerMessage,
  driveMessage,
  lightsMessage,
  steerMessage,
  stopMessage,
} from "@/lib/protocol";

export type BleState = "idle" | "connecting" | "connected" | "error";

function friendlyBleError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("GATT") || msg.includes("NotSupportedError")) {
    return "Bluetooth link busy — wait 1s and try again (or reconnect RC Car).";
  }
  return msg;
}

export function useBleProvision() {
  const [mounted, setMounted] = useState(false);
  const [supported, setSupported] = useState(false);
  const [bleState, setBleState] = useState<BleState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [wifiStatus, setWifiStatus] = useState<WifiStatus | null>(null);
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [controlError, setControlError] = useState<string | null>(null);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const sendWifiRef = useRef<((ssid: string, password: string) => Promise<void>) | null>(null);
  const sendControlRef = useRef<((payload: string) => Promise<void>) | null>(null);
  const requestScanRef = useRef<(() => Promise<void>) | null>(null);
  const forgetWifiRef = useRef<(() => Promise<void>) | null>(null);
  const disconnectWifiRef = useRef<(() => Promise<void>) | null>(null);
  const stopNotifyRef = useRef<(() => void) | null>(null);
  const writeBusyRef = useRef(false);
  const pendingControlRef = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setSupported(isWebBluetoothAvailable());
  }, []);

  const flushControl = async () => {
    if (writeBusyRef.current || !pendingControlRef.current || !sendControlRef.current) return;
    writeBusyRef.current = true;
    const payload = pendingControlRef.current;
    pendingControlRef.current = null;
    try {
      await sendControlRef.current(payload);
      setControlError(null);
    } catch (e) {
      setControlError(friendlyBleError(e));
    } finally {
      writeBusyRef.current = false;
      if (pendingControlRef.current) void flushControl();
    }
  };

  const queueControl = (payload: string) => {
    pendingControlRef.current = payload;
    void flushControl();
  };

  const clearSessionRefs = () => {
    stopNotifyRef.current?.();
    stopNotifyRef.current = null;
    sendWifiRef.current = null;
    sendControlRef.current = null;
    requestScanRef.current = null;
    forgetWifiRef.current = null;
    disconnectWifiRef.current = null;
  };

  const disconnect = () => {
    clearSessionRefs();
    deviceRef.current?.gatt?.disconnect();
    deviceRef.current = null;
    setBleState("idle");
  };

  useEffect(() => () => disconnect(), []);

  const connect = async () => {
    setError(null);
    setControlError(null);
    setBleState("connecting");
    try {
      clearSessionRefs();
      try {
        deviceRef.current?.gatt?.disconnect();
      } catch {
        /* ignore */
      }
      deviceRef.current = null;

      const device = await connectBleDevice();
      deviceRef.current = device;
      device.addEventListener("gattserverdisconnected", () => {
        setBleState("idle");
        setError("Bluetooth disconnected — tap Connect again");
        clearSessionRefs();
      });

      const session = await openBleSession(device);
      sendWifiRef.current = session.sendWifi;
      sendControlRef.current = session.sendControl;
      requestScanRef.current = session.requestScan;
      forgetWifiRef.current = session.forgetWifi;
      disconnectWifiRef.current = session.disconnectWifi;

      stopNotifyRef.current = await session.startNotify((s) => {
        if (s.wifi === "scan" && s.networks) {
          setNetworks(s.networks.filter((n) => n.ssid));
        }
        setWifiStatus((prev) => {
          // Battery-only notify: keep wifi fields, merge batt/usb/charging
          if (s.batt != null && s.wifi == null) {
            return {
              ...(prev ?? {}),
              batt: s.batt,
              usb: s.usb,
              charging: s.charging,
              full: s.full,
              mv: s.mv,
            };
          }
          if (
            prev?.wifi === "connecting" &&
            (s.wifi === "disconnected" || s.wifi === "scanning")
          ) {
            return {
              ...prev,
              ...s,
              wifi: "connecting",
              ssid: prev.ssid ?? s.ssid,
              batt: s.batt ?? prev.batt,
              usb: s.usb ?? prev.usb,
              charging: s.charging ?? prev.charging,
              full: s.full ?? prev.full,
              mv: s.mv ?? prev.mv,
            };
          }
          return {
            ...prev,
            ...s,
            batt: s.batt ?? prev?.batt,
            usb: s.usb ?? prev?.usb,
            charging: s.charging ?? prev?.charging,
            full: s.full ?? prev?.full,
            mv: s.mv ?? prev?.mv,
          };
        });
      });

      setBleState("connected");

      window.setTimeout(() => {
        void session.requestStatus().catch(() => undefined);
        void session.sendControl(centerMessage()).catch(() => undefined);
      }, 400);
    } catch (e) {
      setError(friendlyBleError(e));
      setBleState("error");
    }
  };

  const provisionWifi = async (ssid: string, password: string) => {
    if (!sendWifiRef.current) throw new Error("Bluetooth not connected");
    setWifiStatus({ wifi: "connecting", ssid });
    try {
      await sendWifiRef.current(ssid, password);
    } catch (e) {
      setWifiStatus({ wifi: "failed", ssid, error: friendlyBleError(e) });
      throw e;
    }
  };

  const scanWifi = async () => {
    if (!requestScanRef.current) throw new Error("Bluetooth not connected");
    setWifiStatus((prev) => ({ ...prev, wifi: "scanning" }));
    try {
      await requestScanRef.current();
    } catch (e) {
      setError(friendlyBleError(e));
      setWifiStatus((prev) => ({ ...prev, wifi: "disconnected" }));
    }
  };

  const forgetWifi = async () => {
    if (!forgetWifiRef.current) throw new Error("Bluetooth not connected");
    try {
      await forgetWifiRef.current();
      setWifiStatus({ wifi: "disconnected" });
    } catch (e) {
      setError(friendlyBleError(e));
    }
  };

  const disconnectWifi = async () => {
    if (!disconnectWifiRef.current) throw new Error("Bluetooth not connected");
    try {
      await disconnectWifiRef.current();
      setWifiStatus((prev) => ({
        ...prev,
        wifi: "disconnected",
        ip: undefined,
        ws: undefined,
        stream: undefined,
      }));
    } catch (e) {
      setError(friendlyBleError(e));
    }
  };

  return {
    mounted,
    supported,
    bleState,
    error,
    controlError,
    wifiStatus,
    networks,
    connect,
    disconnect,
    provisionWifi,
    scanWifi,
    forgetWifi,
    disconnectWifi,
    sendSteerBle: (angle: number) => queueControl(steerMessage(angle)),
    sendCenterBle: () => queueControl(centerMessage()),
    sendDriveBle: (left: number, right: number) =>
      queueControl(driveMessage(left, right)),
    sendStopBle: () => queueControl(stopMessage()),
    sendLightsBle: (on: boolean) => queueControl(lightsMessage(on)),
  };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AP_IP,
  AP_PASS,
  DIRECT_AP_SSID,
  SETUP_AP_SSID,
  type CarStatus,
  fetchCarStatus,
  fetchCarStatusRetry,
  isDriveReadyStatus,
  loadEspIp,
  loadHomeSsid,
  provisionWifi,
  carWifiCmd,
  saveEspIp,
  saveHomeSsid,
  streamUrlFromIp,
  wsUrlFromIp,
} from "@/lib/carApi";

export type ConnPhase =
  | "idle"
  | "probing"
  | "unreachable"
  | "setup"
  | "connecting_sta"
  | "switch_phone"
  | "ready"
  | "error";

/** How this phone/browser reaches the car. */
export type LinkPath = "direct" | "home" | "none";

export function useCarConnection() {
  const [phase, setPhase] = useState<ConnPhase>("idle");
  const [status, setStatus] = useState<CarStatus | null>(null);
  const [espIp, setEspIp] = useState("");
  const [homeSsid, setHomeSsid] = useState("");
  const [linkPath, setLinkPath] = useState<LinkPath>("none");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const probeGen = useRef(0);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  /**
   * via "ap"  = we reached SoftAP (192.168.4.1) → always use that IP for WS/cam
   * via "sta" = we reached home LAN IP → use STA IP
   * (ESP status.ip is often the home IP even when SoftAP is also up — don't use it on SoftAP.)
   */
  const applyReady = useCallback((s: CarStatus, via: "ap" | "sta") => {
    const ip =
      via === "ap" ? s.apIp || AP_IP : s.ip || "";
    if (!ip) return;

    saveEspIp(ip);
    setEspIp(ip);
    setLinkPath(via === "ap" ? "direct" : "home");

    if (s.ssid) {
      saveHomeSsid(s.ssid);
      setHomeSsid(s.ssid);
    } else {
      setHomeSsid(loadHomeSsid());
    }

    setStatus(s);
    setPhase("ready");
    setMessage(null);
    setError(null);
  }, []);

  const handleApStatus = useCallback(
    (ap: CarStatus): boolean => {
      setStatus(ap);

      // SoftAP reachable → Direct path (even if car also has home Wi‑Fi)
      if (ap.ap || ap.apIp || ap.mode === "direct" || ap.wifi === "direct") {
        if (ap.mode === "setup" || ap.status === "setup" || ap.wifi === "setup") {
          // First-time provision portal on SoftAP
          if (!(ap.status === "connected" && ap.ip && ap.ip !== AP_IP)) {
            setPhase("setup");
            setLinkPath("direct");
            setEspIp(AP_IP);
            setMessage(ap.message || "Enter home Wi‑Fi credentials");
            return true;
          }
        }
        applyReady(ap, "ap");
        return true;
      }

      if (
        ap.mode === "setup" &&
        ap.status === "connected" &&
        ap.ip &&
        ap.ip !== AP_IP
      ) {
        if (ap.ssid) {
          saveHomeSsid(ap.ssid);
          setHomeSsid(ap.ssid);
        }
        saveEspIp(ap.ip);
        setEspIp(ap.ip);
        setPhase("switch_phone");
        setMessage(
          `Car joined ${ap.ssid || "home Wi‑Fi"}.\n\nSwitch your phone to that network, then reconnect.`,
        );
        return true;
      }

      if (ap.mode === "setup" || ap.status === "setup" || ap.wifi === "setup") {
        setPhase("setup");
        setLinkPath("direct");
        setEspIp(AP_IP);
        setMessage(ap.message || "Enter home Wi‑Fi credentials");
        return true;
      }

      if (isDriveReadyStatus(ap)) {
        applyReady(ap, "ap");
        return true;
      }

      return false;
    },
    [applyReady],
  );

  const probe = useCallback(async () => {
    const gen = ++probeGen.current;
    setPhase("probing");
    setError(null);
    setMessage("Looking for car…");
    setLinkPath("none");
    stopPoll();

    const saved = loadEspIp();
    setEspIp(saved);
    setHomeSsid(loadHomeSsid());

    // SoftAP first — if reachable, we're on Porsche_RC_Car
    const ap = await fetchCarStatus(AP_IP, 2000);
    if (gen !== probeGen.current) return;
    if (ap && handleApStatus(ap)) return;

    // Home LAN IP
    const candidates = [saved, loadEspIp()].filter(
      (ip, i, arr) => ip && ip !== AP_IP && arr.indexOf(ip) === i,
    );
    for (const ip of candidates) {
      const home = await fetchCarStatus(ip!, 2000);
      if (gen !== probeGen.current) return;
      if (home && isDriveReadyStatus(home)) {
        applyReady(home, "sta");
        return;
      }
    }

    if (gen !== probeGen.current) return;
    setPhase("unreachable");
    setMessage(null);
    setError(null);
  }, [applyReady, handleApStatus]);

  const probeDirect = useCallback(async () => {
    const gen = ++probeGen.current;
    setPhase("probing");
    setError(null);
    setMessage(`Waiting for ${DIRECT_AP_SSID}…`);
    setLinkPath("none");
    stopPoll();

    const ap = await fetchCarStatusRetry(AP_IP, {
      attempts: 10,
      timeoutMs: 1800,
      gapMs: 600,
    });
    if (gen !== probeGen.current) return;

    if (ap && handleApStatus(ap)) return;

    setPhase("unreachable");
    setMessage(null);
    setError(
      `Still can’t reach the car at ${AP_IP}. Stay on ${DIRECT_AP_SSID} (ignore “no internet”), then try again.`,
    );
  }, [handleApStatus]);

  useEffect(() => {
    void probe();
    return () => {
      stopPoll();
      probeGen.current++;
    };
  }, [probe]);

  useEffect(() => {
    if (phase !== "setup" && phase !== "connecting_sta" && phase !== "switch_phone") {
      stopPoll();
      return;
    }

    stopPoll();
    pollRef.current = setInterval(() => {
      void (async () => {
        const s = await fetchCarStatus(AP_IP, 2000);
        if (!s) return;
        setStatus(s);
        setMessage(s.message || null);

        if (s.status === "connecting" || s.wifi === "connecting") {
          setPhase("connecting_sta");
          return;
        }
        if (s.status === "failed" || s.wifi === "failed") {
          setPhase("setup");
          setError(s.error || s.message || "Connection failed");
          return;
        }
        if (s.status === "connected" && s.ip && s.ip !== AP_IP) {
          if (s.ssid) {
            saveHomeSsid(s.ssid);
            setHomeSsid(s.ssid);
          }
          saveEspIp(s.ip);
          setEspIp(s.ip);
          setPhase("switch_phone");
          setMessage(
            `Car joined ${s.ssid || "home Wi‑Fi"}.\n\nSwitch your phone to that network, then Reconnect.`,
          );
          return;
        }
        // Still on SoftAP and drive-ready
        if (s.ap || s.mode === "direct") {
          applyReady(s, "ap");
        }
      })();
    }, 1000);

    return () => stopPoll();
  }, [phase, applyReady]);

  const submitWifi = async (ssid: string, password: string) => {
    setError(null);
    setPhase("connecting_sta");
    setMessage("Connecting…");
    try {
      const res = await provisionWifi(AP_IP, ssid, password);
      if (!res.ok) {
        setPhase("setup");
        setError(res.error || "Provision failed");
        return;
      }
      saveHomeSsid(ssid);
      setHomeSsid(ssid);
      setMessage(res.message || "Connecting…");
    } catch {
      setPhase("unreachable");
      setError(`Join ${SETUP_AP_SSID} first, then try again.`);
    }
  };

  const openSetup = () => {
    setPhase("setup");
    setError(null);
    setMessage("Enter home Wi‑Fi so the car can join your router.");
    setEspIp(AP_IP);
    setLinkPath("direct");
  };

  /** Drop app link (stops drive/camera). Does not change ESP SoftAP. */
  const disconnect = () => {
    stopPoll();
    probeGen.current++;
    setPhase("unreachable");
    setLinkPath("none");
    setEspIp("");
    setStatus(null);
    setMessage(null);
    setError(null);
  };

  /** Tell car to leave home Wi‑Fi; SoftAP stays. */
  const disconnectCarHome = async () => {
    setError(null);
    const target = linkPath === "home" && espIp ? espIp : AP_IP;
    try {
      const res = await carWifiCmd(target, "disconnect");
      if (!res.ok) {
        setError(res.error || "Disconnect failed");
        return;
      }
      if (target === AP_IP) {
        applyReady(
          {
            mode: "direct",
            status: "connected",
            wifi: "direct",
            ap: true,
            apIp: AP_IP,
          },
          "ap",
        );
        setMessage(res.message || "Car left home Wi‑Fi");
      } else {
        stopPoll();
        setPhase("unreachable");
        setLinkPath("none");
        setEspIp("");
        setStatus(null);
        setMessage(
          `Car left home Wi‑Fi. Join ${DIRECT_AP_SSID} / ${AP_PASS}, then Direct.`,
        );
      }
    } catch {
      setError(
        `Can't reach car at ${target}. Join ${DIRECT_AP_SSID} or home Wi‑Fi first.`,
      );
    }
  };

  /** Forget saved home credentials on the car. */
  const forgetCarHome = async () => {
    setError(null);
    const target = linkPath === "home" && espIp ? espIp : AP_IP;
    try {
      const res = await carWifiCmd(target, "forget");
      if (!res.ok) {
        setError(res.error || "Forget failed");
        return;
      }
      saveHomeSsid("");
      setHomeSsid("");
      if (target === AP_IP) {
        setPhase("setup");
        setLinkPath("direct");
        setEspIp(AP_IP);
        setMessage("Home Wi‑Fi cleared. Enter new credentials or drive on hotspot.");
      } else {
        stopPoll();
        setPhase("unreachable");
        setLinkPath("none");
        setEspIp("");
        setStatus(null);
        setMessage(
          `Home Wi‑Fi cleared. Join ${DIRECT_AP_SSID} / ${AP_PASS} to set it again.`,
        );
      }
    } catch {
      setError(
        `Can't reach car at ${target}. Join ${DIRECT_AP_SSID} or home Wi‑Fi first.`,
      );
    }
  };

  const wsUrl = espIp && phase === "ready" ? wsUrlFromIp(espIp) : "";
  const streamUrl =
    espIp && phase === "ready"
      ? streamUrlFromIp(espIp)
      : phase === "setup" || phase === "connecting_sta"
        ? streamUrlFromIp(AP_IP)
        : null;

  const linkLabel =
    linkPath === "direct"
      ? `${DIRECT_AP_SSID} · ${espIp || AP_IP}`
      : linkPath === "home"
        ? `${homeSsid || "Home Wi‑Fi"} · ${espIp}`
        : espIp || undefined;

  return {
    phase,
    status,
    espIp,
    homeSsid,
    linkPath,
    linkLabel,
    error,
    message,
    wsUrl,
    streamUrl,
    setupApSsid: SETUP_AP_SSID,
    directApSsid: DIRECT_AP_SSID,
    probe,
    probeDirect,
    submitWifi,
    openSetup,
    disconnect,
    disconnectCarHome,
    forgetCarHome,
  };
}

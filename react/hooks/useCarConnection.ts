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
  isHttpsApp,
  isLanIp,
  loadEspIp,
  loadHomeLanIp,
  loadHomeSsid,
  loadVideoQuality,
  provisionWifi,
  carWifiCmd,
  rememberCarIps,
  saveEspIp,
  saveHomeLanIp,
  saveHomeSsid,
  saveVideoQuality,
  setCarVideoQuality,
  streamUrlFromIp,
  type VideoQuality,
  videoPollMs,
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
  const [homeLanIp, setHomeLanIp] = useState("");
  const [linkPath, setLinkPath] = useState<LinkPath>("none");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [videoQuality, setVideoQualityState] = useState<VideoQuality>("auto");
  const [httpsApp, setHttpsApp] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const probeGen = useRef(0);

  useEffect(() => {
    setVideoQualityState(loadVideoQuality());
    setHomeLanIp(loadHomeLanIp());
    setHttpsApp(isHttpsApp());
  }, []);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  /**
   * via "ap"  = SoftAP path → control at 192.168.4.1
   * via "sta" = home LAN path → control at STA IP
   * Never overwrite the saved home LAN IP with SoftAP 192.168.4.1.
   */
  const applyReady = useCallback((s: CarStatus, via: "ap" | "sta") => {
    rememberCarIps(s);

    const ip = via === "ap" ? s.apIp || AP_IP : s.ip || s.staIp || "";
    if (!ip) return;

    if (via === "sta" && isLanIp(ip)) {
      saveHomeLanIp(ip);
      setHomeLanIp(ip);
      saveEspIp(ip);
    } else {
      // SoftAP control IP — keep home LAN IP intact
      saveEspIp(ip);
      const sta = s.staIp || (s.ip && s.ip !== AP_IP ? s.ip : "");
      if (sta) {
        saveHomeLanIp(sta);
        setHomeLanIp(sta);
      }
    }

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
      rememberCarIps(ap);

      // SoftAP reachable → Direct path (even if car also has home Wi‑Fi)
      if (ap.ap || ap.apIp || ap.mode === "direct" || ap.wifi === "direct") {
        if (ap.mode === "setup" || ap.status === "setup" || ap.wifi === "setup") {
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
        saveHomeLanIp(ap.ip);
        saveEspIp(ap.ip);
        setEspIp(ap.ip);
        setPhase("switch_phone");
        setMessage(
          `Car joined ${ap.ssid || "home Wi‑Fi"} at ${ap.ip}.\n\n` +
            `1) Switch iPhone to that Wi‑Fi\n` +
            `2) Open http://${ap.ip}/ in Safari (not the HTTPS app)\n` +
            `   or tap Home → Reconnect if your browser allows local HTTP.`,
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

    const homeLan = loadHomeLanIp();
    const saved = loadEspIp();
    setEspIp(homeLan || saved);
    setHomeSsid(loadHomeSsid());

    // SoftAP first — only works if phone is on Porsche_RC_Car
    const ap = await fetchCarStatus(AP_IP, 1800);
    if (gen !== probeGen.current) return;
    if (ap && handleApStatus(ap)) return;

    // Home LAN IPs (never SoftAP)
    const candidates = [homeLan, saved, loadEspIp()].filter(
      (ip, i, arr) => isLanIp(ip) && arr.indexOf(ip) === i,
    );
    for (const ip of candidates) {
      const home = await fetchCarStatus(ip!, 2500);
      if (gen !== probeGen.current) return;
      if (home && isDriveReadyStatus(home)) {
        applyReady(home, "sta");
        return;
      }
    }

    if (gen !== probeGen.current) return;
    setPhase("unreachable");
    setMessage(null);
    if (isHttpsApp()) {
      setError(
        "iPhone / HTTPS app cannot reach the car over http://. " +
          "Use SoftAP + Safari http://192.168.4.1, or home Wi‑Fi + Safari http://<car-ip>.",
      );
    } else {
      setError(null);
    }
  }, [applyReady, handleApStatus]);

  const probeIp = useCallback(
    async (raw: string) => {
      const ip = raw.trim().replace(/^https?:\/\//, "").split("/")[0] ?? "";
      if (!ip) {
        setError("Enter the car IP (e.g. 192.168.1.50)");
        return;
      }
      const gen = ++probeGen.current;
      setPhase("probing");
      setError(null);
      setMessage(`Trying ${ip}…`);
      const s = await fetchCarStatusRetry(ip, {
        attempts: 4,
        timeoutMs: 2000,
        gapMs: 500,
      });
      if (gen !== probeGen.current) return;
      if (s && isDriveReadyStatus(s)) {
        if (ip === AP_IP || s.ap) applyReady({ ...s, apIp: AP_IP }, "ap");
        else applyReady({ ...s, ip }, "sta");
        return;
      }
      setPhase("unreachable");
      if (isHttpsApp()) {
        setError(
          `Blocked or unreachable from HTTPS. On iPhone open Safari → http://${ip}/`,
        );
      } else {
        setError(`No car at ${ip}. Check Wi‑Fi and IP.`);
      }
    },
    [applyReady],
  );

  const probeDirect = useCallback(async () => {
    const gen = ++probeGen.current;
    setPhase("probing");
    setError(null);
    setMessage(`Waiting for ${DIRECT_AP_SSID}… (DHCP can take a few seconds)`);
    setLinkPath("none");
    stopPoll();

    const ap = await fetchCarStatusRetry(AP_IP, {
      attempts: 16,
      timeoutMs: 2000,
      gapMs: 500,
    });
    if (gen !== probeGen.current) return;

    if (ap && handleApStatus(ap)) return;

    setPhase("unreachable");
    setMessage(null);
    setError(
      `Still can’t reach ${AP_IP}. Stay on ${DIRECT_AP_SSID} / ${AP_PASS}, ignore “no internet”, open http://192.168.4.1/ then try again.`,
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
          rememberCarIps(s);
          saveHomeLanIp(s.ip);
          setHomeLanIp(s.ip);
          saveEspIp(s.ip);
          setEspIp(s.ip);
          setPhase("switch_phone");
          setMessage(
            `Car joined ${s.ssid || "home Wi‑Fi"} · ${s.ip}\n\n` +
              `iPhone: leave SoftAP → join home Wi‑Fi → open http://${s.ip}/ in Safari.`,
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

  const setVideoQuality = async (q: VideoQuality) => {
    saveVideoQuality(q);
    setVideoQualityState(q);
    if (!espIp) return;
    try {
      await setCarVideoQuality(espIp, q);
    } catch {
      /* local preference still applied for poll rate */
    }
  };

  // Push quality to car when link becomes ready
  useEffect(() => {
    if (phase !== "ready" || !espIp) return;
    void setCarVideoQuality(espIp, videoQuality).catch(() => undefined);
  }, [phase, espIp, videoQuality]);

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
    probeIp,
    homeLanIp,
    httpsApp,
    submitWifi,
    openSetup,
    disconnect,
    disconnectCarHome,
    forgetCarHome,
    videoQuality,
    videoPollMs: videoPollMs(videoQuality),
    setVideoQuality,
  };
}

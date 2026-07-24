#pragma once

#include <Arduino.h>
#include <functional>

/**
 * Clean Wi‑Fi policy:
 *   direct — SoftAP only (WIFI_AP). Drive at 192.168.4.1. No STA scan.
 *   setup  — SoftAP; waiting for / providing home credentials.
 *   home   — STA on router (+ SoftAP kept for fallback when idle).
 *
 * Home join never starts while SoftAP has connected clients.
 */
enum class WifiPhase : uint8_t {
  Boot,
  DirectAp,
  SetupAp,
  PendingHome,   // creds saved; waiting for SoftAP idle then STA
  ConnectingSta,
  Connected,     // Home Mode
};

class WifiManager {
public:
  using StatusFn = std::function<void(const String &json)>;
  using NetworkFn = std::function<void()>;

  void begin(StatusFn onStatus, NetworkFn onNetwork = nullptr);
  void loop();

  void bootSoftAp();
  void trySavedOrFallback();
  void setNetworkNotifyEnabled(bool enabled) { _notifyEnabled = enabled; }
  void notifyNetworkNow() { notifyNetwork(); }

  void startSetupAp();
  void startDirectAp();
  void stopSoftAp();

  void connectAndSave(const String &ssid, const String &pass);
  void forgetSaved();
  void disconnectSta();

  bool hasSavedSsid() const;
  bool isStaConnected() const;
  bool isApActive() const { return _apActive; }
  bool isDirectMode() const {
    return _phase == WifiPhase::DirectAp || _phase == WifiPhase::PendingHome;
  }
  bool isSetupMode() const {
    return _phase == WifiPhase::SetupAp || _phase == WifiPhase::ConnectingSta;
  }
  bool isHomeMode() const { return _phase == WifiPhase::Connected && isStaConnected(); }
  bool isDriveReady() const {
    return _apActive || isStaConnected();
  }

  WifiPhase phase() const { return _phase; }
  String controlIp() const;
  String homeSsid() const { return _ssid; }
  String statusJson() const;
  int softApClients() const;

private:
  StatusFn _onStatus;
  NetworkFn _onNetwork;
  WifiPhase _phase = WifiPhase::Boot;
  bool _apActive = false;
  bool _connecting = false;
  bool _notifyEnabled = false;
  bool _wantHome = false; // saved/explicit home join when SoftAP idle
  const char *_apSsid = nullptr;
  uint32_t _phaseStartedMs = 0;
  uint32_t _attemptStartedMs = 0;
  uint32_t _softApIdleSinceMs = 0;
  uint32_t _lastStaTryMs = 0;
  uint8_t _connectAttempt = 0;
  uint8_t _apChannel = 6;
  String _ssid;
  String _pass;
  String _message;
  int _lastFailReason = 0;

  void emitStatus();
  void notifyNetwork();
  void setMessage(const String &msg);
  void beginStaAttempt();
  void onStaConnected();
  void onStaFailed(const String &error);
  void enterSetup(const char *reason);
  void enterDirect(const char *reason);
  void startSoftAp(bool apSta);
  void ensureSoftAp(bool apSta);
  bool softApHealthy() const;
  void maybeStartHomeJoin(uint32_t now);
};

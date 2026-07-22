#pragma once

#include <Arduino.h>
#include <functional>

/**
 * Wi‑Fi modes (one SoftAP SSID always: Porsche_RC_Car):
 *   home   — STA on saved router (OTA allowed)
 *   setup  — SoftAP + provision portal (no saved Wi‑Fi yet)
 *   direct — SoftAP fully drivable (no router / STA failed)
 */
enum class WifiPhase : uint8_t {
  Boot,
  TryingSaved,
  SetupAp,
  ConnectingSta,
  ConnectedHoldAp,
  Connected, // Home Mode
  DirectAp,  // Direct Mode
};

class WifiManager {
public:
  using StatusFn = std::function<void(const String &json)>;
  /** Fired after SoftAP / STA is up — rebind HTTP & WS (only when enabled). */
  using NetworkFn = std::function<void()>;

  void begin(StatusFn onStatus, NetworkFn onNetwork = nullptr);
  void loop();

  /** Must run BEFORE WebServer/WebSocket — initializes lwIP SoftAP. */
  void bootSoftAp();
  /** After HTTP is listening: try saved STA or stay Direct/Setup. */
  void trySavedOrFallback();
  void setNetworkNotifyEnabled(bool enabled) { _notifyEnabled = enabled; }
  void notifyNetworkNow() { notifyNetwork(); }

  void startSetupAp();
  void startDirectAp();
  void stopSoftAp();

  void connectAndSave(const String &ssid, const String &pass);
  void forgetSaved();
  /** Drop STA / home Wi‑Fi; SoftAP stays up. Creds kept. */
  void disconnectSta();

  bool hasSavedSsid() const;
  bool isStaConnected() const;
  bool isApActive() const { return _apActive; }
  bool isDirectMode() const {
    return _phase == WifiPhase::DirectAp ||
           (_phase == WifiPhase::TryingSaved && _apActive);
  }
  bool isSetupMode() const {
    return _phase == WifiPhase::SetupAp || _phase == WifiPhase::ConnectingSta ||
           _phase == WifiPhase::ConnectedHoldAp;
  }
  bool isHomeMode() const {
    return _phase == WifiPhase::Connected ||
           (_phase == WifiPhase::ConnectedHoldAp && isStaConnected());
  }
  bool isDriveReady() const {
    return isStaConnected() || _phase == WifiPhase::DirectAp ||
           (_phase == WifiPhase::TryingSaved && _apActive);
  }

  WifiPhase phase() const { return _phase; }
  String controlIp() const;
  String homeSsid() const { return _ssid; }
  String statusJson() const;

private:
  StatusFn _onStatus;
  NetworkFn _onNetwork;
  WifiPhase _phase = WifiPhase::Boot;
  bool _apActive = false;
  bool _connecting = false;
  bool _notifyEnabled = false;
  const char *_apSsid = nullptr;
  uint32_t _phaseStartedMs = 0;
  uint32_t _attemptStartedMs = 0;
  uint32_t _apHoldUntilMs = 0;
  uint8_t _connectAttempt = 0;
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
  void startSoftAp(const char *ssid, const char *pass, bool apSta);
  void ensureSoftAp(bool apSta);
};

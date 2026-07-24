#pragma once

#include <Arduino.h>
#include <WebServer.h>
#include <functional>
#include "config.h"

class BatteryMonitor;
class CameraStream;

/**
 * SoftAP always (drive anywhere). Optional home STA when saved.
 * HTTP :80 — status / setup / camera (camera last).
 */
class WifiControl {
public:
  using StatusFn = std::function<void(const String &json)>;

  void begin(BatteryMonitor *batt, CameraStream *cam, StatusFn onStatus = nullptr);
  void loop();

  void startSoftAp();
  void tryHomeSta();
  void connectHome(const String &ssid, const String &pass);
  void forgetHome();
  void disconnectHome();

  bool softApUp() const { return _apUp; }
  bool homeConnected() const;
  String softApIp() const;
  String homeIp() const;
  String statusJson() const;
  WebServer &http() { return _http; }

private:
  WebServer _http{HTTP_PORT};
  BatteryMonitor *_batt = nullptr;
  CameraStream *_cam = nullptr;
  StatusFn _onStatus;

  bool _apUp = false;
  bool _httpUp = false;
  bool _camRoutes = false;
  bool _staWanted = false;
  bool _staPausedForApClients = false;
  String _ssid;
  String _pass;
  uint32_t _staStartedMs = 0;
  uint8_t _staAttempt = 0;
  uint32_t _lastStatusLogMs = 0;

  void setupHttp();
  void ensureCamRoutes();
  void emitStatus();
  void loadCreds();
  void saveCreds(const String &ssid, const String &pass, bool ok);
  void beginSta();
  void pauseStaForApClients(bool pause);
  int softApClients() const;
};

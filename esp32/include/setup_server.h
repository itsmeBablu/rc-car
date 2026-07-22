#pragma once

#include <Arduino.h>
#include <DNSServer.h>
#include <WebServer.h>
#include "config.h"

class WifiManager;
class CameraStream;
class BatteryMonitor;

/** HTTP :80 — status, provision, battery, camera (+ SoftAP DNS). */
class SetupServer {
public:
  void begin(WifiManager *wifi, CameraStream *camera, BatteryMonitor *battery);
  /** Call after SoftAP / STA interface changes — ESP WebServer often dies on mode switch. */
  void rebind();
  void loop();
  bool isRunning() const { return _running; }

private:
  WebServer _http{HTTP_PORT};
  DNSServer _dns;
  WifiManager *_wifi = nullptr;
  CameraStream *_camera = nullptr;
  BatteryMonitor *_battery = nullptr;
  bool _running = false;
  bool _dnsRunning = false;
  bool _routesRegistered = false;
  String _postBody;

  void registerRoutes();
  void syncDns();
  void sendCors();
  void handleOptions();
  void handleRoot();
  void handleStatus();
  void handleBattery();
  void handleWifiPost();
  void handleVideoGet();
  void handleVideoPost();
  void handleCaptive();
};

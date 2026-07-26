#pragma once

#include <Arduino.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <functional>
#include "config.h"

class BatteryMonitor;
class CameraStream;

static const int WIFI_NET_MAX = 10;

struct SavedWifi {
  String ssid;
  String pass;
  uint32_t lastUsed = 0; // higher = more recent
};

/**
 * SoftAP always (drive anywhere). Optional home STA — up to 10 saved networks.
 * HTTP :80 + SoftAP DNS captive portal.
 */
class WifiControl {
public:
  using StatusFn = std::function<void(const String &json)>;

  void begin(BatteryMonitor *batt, CameraStream *cam, StatusFn onStatus = nullptr);
  void loop();

  void startSoftAp();
  void tryHomeSta();
  /** Upsert network (max 10, drop least-recently-used), then join it. */
  void connectHome(const String &ssid, const String &pass);
  void forgetNetwork(const String &ssid);
  void forgetAllNetworks();
  bool connectSaved(const String &ssid);
  void disconnectHome();

  bool softApUp() const { return _apUp; }
  bool homeConnected() const;
  String softApIp() const;
  String homeIp() const;
  String statusJson() const;
  String networksJson() const;
  WebServer &http() { return _http; }

private:
  WebServer _http{HTTP_PORT};
  DNSServer _dns;
  BatteryMonitor *_batt = nullptr;
  CameraStream *_cam = nullptr;
  StatusFn _onStatus;

  bool _apUp = false;
  bool _httpUp = false;
  bool _camRoutes = false;
  bool _staWanted = false;
  bool _staPausedForApClients = false;
  bool _dnsRunning = false;

  SavedWifi _nets[WIFI_NET_MAX];
  uint8_t _netCount = 0;
  int8_t _activeIdx = -1;
  uint8_t _tryOrder[WIFI_NET_MAX];
  uint8_t _tryPos = 0;
  uint32_t _useSeq = 1;

  String _ssid;
  String _pass;
  uint32_t _staStartedMs = 0;
  uint8_t _staAttempt = 0;
  uint32_t _lastStatusLogMs = 0;

  void setupHttp();
  void ensureCamRoutes();
  void ensureDns();
  void emitStatus();
  void loadCreds();
  void persistNets();
  void syncActiveFromIdx();
  int findNet(const String &ssid) const;
  void touchNet(int idx);
  void rebuildTryOrder();
  void beginSta();
  void beginStaAt(int idx);
  void tryNextSta();
  void pauseStaForApClients(bool pause);
  int softApClients() const;
  String portalHtml() const;
};

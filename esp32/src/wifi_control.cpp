#include "wifi_control.h"
#include "config.h"

#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>

static Preferences prefs;
static int gDisconnectReason = 0;

static void onWifiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
    gDisconnectReason = info.wifi_sta_disconnected.reason;
    Serial.printf("[wifi] disconnect reason=%d\n", gDisconnectReason);
  } else if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
    Serial.printf("[wifi] got IP %s\n", WiFi.localIP().toString().c_str());
  }
}

static const char *reasonToError(int reason) {
  switch (reason) {
  case 2: return "auth_expire";
  case 15: return "wrong_password";
  case 201: return "ssid_not_found";
  case 202: return "auth_fail";
  case 203: return "assoc_fail";
  case 204: return "handshake_timeout";
  default: return "timeout";
  }
}

void WifiControl::begin(StatusFn onStatus) {
  _onStatus = onStatus;
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setSleep(true);
  WiFi.onEvent(onWifiEvent);
  emitStatus();
}

void WifiControl::emitStatus() {
  if (_onStatus) _onStatus(statusJson());
}

void WifiControl::emitFail(const String &error) {
  _connecting = false;
  _scanning = false;
  _scanThenConnect = false;
  _lastFailError = error;
  prefs.begin("rc-car", false);
  prefs.putBool("ok", false);
  prefs.end();

  JsonDocument doc;
  doc["wifi"] = "failed";
  doc["ssid"] = _ssid;
  doc["error"] = error;
  if (_lastFailReason) doc["reason"] = _lastFailReason;
  String out;
  serializeJson(doc, out);
  if (_onStatus) _onStatus(out);
  Serial.printf("[wifi] FAIL %s (reason=%d)\n", error.c_str(), _lastFailReason);
}

String WifiControl::statusJson() const {
  JsonDocument doc;
  if (WiFi.status() == WL_CONNECTED) {
    doc["wifi"] = "connected";
    doc["ip"] = WiFi.localIP().toString();
    doc["ssid"] = WiFi.SSID();
    doc["ws"] = String("ws://") + WiFi.localIP().toString() + ":" + String(WS_PORT);
    doc["stream"] =
        String("http://") + WiFi.localIP().toString() + "/stream";
  } else if (_connecting) {
    doc["wifi"] = "connecting";
    doc["ssid"] = _ssid;
    doc["attempt"] = _connectAttempt;
  } else if (_scanning) {
    doc["wifi"] = "scanning";
  } else {
    doc["wifi"] = "disconnected";
    if (_lastFailError.length()) doc["error"] = _lastFailError;
  }
  String out;
  serializeJson(doc, out);
  return out;
}

bool WifiControl::isConnected() const {
  return WiFi.status() == WL_CONNECTED;
}

String WifiControl::localIp() const {
  return WiFi.localIP().toString();
}

void WifiControl::trySaved() {
  prefs.begin("rc-car", true);
  String ssid = prefs.getString("ssid", "");
  String pass = prefs.getString("pass", "");
  bool ok = prefs.getBool("ok", false);
  prefs.end();
  if (ssid.length() == 0 || !ok) {
    Serial.println("[wifi] no verified saved credentials — waiting for BLE provision");
    emitStatus();
    return;
  }
  Serial.printf("[wifi] trying saved SSID \"%s\"\n", ssid.c_str());
  startConnect(ssid, pass, false);
}

void WifiControl::forgetSaved() {
  prefs.begin("rc-car", false);
  prefs.clear();
  prefs.end();
  WiFi.disconnect(false, false);
  _connecting = false;
  _lastFailError = "";
  Serial.println("[wifi] forgot saved credentials");
  emitStatus();
}

void WifiControl::connectAndSave(const String &ssid, const String &pass) {
  startConnect(ssid, pass, true);
}

void WifiControl::startConnect(const String &ssid, const String &pass, bool save) {
  _ssid = ssid;
  _pass = pass;
  _connecting = true;
  _scanning = false;
  _scanThenConnect = false; // direct connect — pre-scan hangs under BLE
  _connectAttempt = 0;
  _lastFailReason = 0;
  _lastFailError = "";
  gDisconnectReason = 0;

  if (save) {
    prefs.begin("rc-car", false);
    prefs.putString("ssid", ssid);
    prefs.putString("pass", pass);
    prefs.putBool("ok", false);
    prefs.end();
  }

  Serial.printf("[wifi] connect \"%s\" (pass %u chars)\n",
                ssid.c_str(), (unsigned)pass.length());
  beginStaConnect();
}

void WifiControl::beginStaConnect() {
  _connectAttempt++;
  _connectStartedMs = millis();
  gDisconnectReason = 0;
  WiFi.disconnect(false, false);
  delay(100);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(true);
  WiFi.begin(_ssid.c_str(), _pass.c_str());
  Serial.printf("[wifi] begin() attempt %u\n", (unsigned)_connectAttempt);
  emitStatus();
}

void WifiControl::startScan() {
  if (_connecting) return;
  _scanning = true;
  _scanThenConnect = false;
  _connectStartedMs = millis(); // reuse for scan timeout
  emitStatus();
  Serial.println("[wifi] scanning...");
  WiFi.scanNetworks(true, true);
}

void WifiControl::emitScanResults(int n) {
  JsonDocument doc;
  doc["wifi"] = "scan";
  JsonArray nets = doc["networks"].to<JsonArray>();
  const int maxN = min(n, 12);
  for (int i = 0; i < maxN; i++) {
    JsonObject o = nets.add<JsonObject>();
    o["ssid"] = WiFi.SSID(i);
    o["rssi"] = WiFi.RSSI(i);
    o["secure"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
  }
  String out;
  serializeJson(doc, out);
  if (out.length() > 480) {
    doc["networks"].to<JsonArray>().clear();
    for (int i = 0; i < min(n, 6); i++) {
      JsonObject o = doc["networks"].add<JsonObject>();
      o["ssid"] = WiFi.SSID(i);
      o["rssi"] = WiFi.RSSI(i);
    }
    out = "";
    serializeJson(doc, out);
  }
  if (_onStatus) _onStatus(out);
  Serial.printf("[wifi] scan done, %d nets\n", n);
}

void WifiControl::loop() {
  static wl_status_t last = WL_IDLE_STATUS;
  wl_status_t st = WiFi.status();

  if (_scanning) {
    int n = WiFi.scanComplete();
    if (n == WIFI_SCAN_FAILED) {
      _scanning = false;
      emitFail("scan_failed");
    } else if (n >= 0) {
      _scanning = false;
      emitScanResults(n);
      WiFi.scanDelete();
      emitStatus();
    } else if (millis() - _connectStartedMs > 10000) {
      _scanning = false;
      WiFi.scanDelete();
      emitFail("scan_timeout");
    }
  }

  if (_connecting && !_scanning) {
    if (st == WL_CONNECTED) {
      _connecting = false;
      Serial.printf("[wifi] OK ip=%s\n", WiFi.localIP().toString().c_str());
      prefs.begin("rc-car", false);
      prefs.putBool("ok", true);
      prefs.end();
      if (MDNS.begin(MDNS_HOSTNAME)) {
        MDNS.addService("ws", "tcp", WS_PORT);
      }
      emitStatus();
    } else if (millis() - _connectStartedMs > 15000) {
      _lastFailReason = gDisconnectReason;
      if (_connectAttempt < 2) {
        Serial.println("[wifi] retry...");
        beginStaConnect();
      } else {
        const char *err = _lastFailReason ? reasonToError(_lastFailReason) : "timeout";
        if (st == WL_NO_SSID_AVAIL) err = "ssid_not_found";
        if (st == WL_CONNECT_FAILED) err = "connect_failed_check_password";
        emitFail(err);
      }
    }
  } else if (st != last) {
    if (st != WL_CONNECTED && last == WL_CONNECTED) {
      Serial.println("[wifi] lost connection");
      emitStatus();
    }
  }
  last = st;
}

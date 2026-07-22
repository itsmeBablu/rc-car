#include "wifi_manager.h"
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
  }
}

static const char *reasonToError(int reason) {
  switch (reason) {
  case 2:
    return "auth_expire";
  case 15:
    return "wrong_password";
  case 201:
    return "ssid_not_found";
  case 202:
    return "auth_fail";
  case 203:
    return "assoc_fail";
  case 204:
    return "handshake_timeout";
  default:
    return "timeout";
  }
}

void WifiManager::begin(StatusFn onStatus, NetworkFn onNetwork) {
  _onStatus = onStatus;
  _onNetwork = onNetwork;
  _notifyEnabled = false;
  WiFi.persistent(false);
  WiFi.setSleep(false);
  WiFi.onEvent(onWifiEvent);
  _phase = WifiPhase::Boot;
  setMessage("boot");
}

void WifiManager::notifyNetwork() {
  if (_notifyEnabled && _onNetwork) _onNetwork();
}

bool WifiManager::hasSavedSsid() const {
  prefs.begin("rc-car", true);
  const String ssid = prefs.getString("ssid", "");
  prefs.end();
  return ssid.length() > 0;
}

bool WifiManager::isStaConnected() const {
  return WiFi.status() == WL_CONNECTED;
}

String WifiManager::controlIp() const {
  if (isStaConnected()) return WiFi.localIP().toString();
  if (_apActive) return WiFi.softAPIP().toString();
  return "";
}

void WifiManager::setMessage(const String &msg) { _message = msg; }

void WifiManager::emitStatus() {
  if (_onStatus) _onStatus(statusJson());
}

String WifiManager::statusJson() const {
  JsonDocument doc;
  const String ip = controlIp();

  if (isStaConnected() &&
      (_phase == WifiPhase::Connected || _phase == WifiPhase::ConnectedHoldAp)) {
    doc["mode"] = "home";
    doc["status"] = "connected";
    doc["wifi"] = "connected";
  } else if (_phase == WifiPhase::DirectAp ||
             (_phase == WifiPhase::TryingSaved && _apActive)) {
    doc["mode"] = "direct";
    doc["status"] = "connected";
    doc["wifi"] = "direct";
    if (_connecting) doc["sta"] = "connecting";
  } else if (_connecting) {
    doc["mode"] = "setup";
    doc["status"] = "connecting";
    doc["wifi"] = "connecting";
    doc["attempt"] = _connectAttempt;
  } else if (_phase == WifiPhase::SetupAp || _phase == WifiPhase::ConnectedHoldAp) {
    doc["mode"] = "setup";
    doc["status"] = "setup";
    doc["wifi"] = "setup";
  } else if (_apActive) {
    doc["mode"] = "direct";
    doc["status"] = "connected";
    doc["wifi"] = "direct";
  } else {
    doc["mode"] = "home";
    doc["status"] = "disconnected";
    doc["wifi"] = "disconnected";
  }

  doc["phase"] = static_cast<int>(_phase);
  doc["message"] = _message;
  doc["ap"] = _apActive;
  if (_apActive) {
    doc["apSsid"] = AP_SSID;
    doc["apIp"] = WiFi.softAPIP().toString();
  }
  if (ip.length()) {
    doc["ip"] = ip;
    doc["ws"] = String("ws://") + ip + ":" + String(WS_PORT);
    doc["stream"] = String("http://") + ip + "/stream";
    doc["jpg"] = String("http://") + ip + "/jpg";
    doc["battery"] = String("http://") + ip + "/api/battery";
  }
  if (_ssid.length()) doc["ssid"] = _ssid;
  if (isStaConnected()) doc["ssid"] = WiFi.SSID();

  String out;
  serializeJson(doc, out);
  return out;
}

/** Start / re-assert SoftAP. Always keep Porsche_RC_Car visible. */
void WifiManager::startSoftAp(const char *ssid, const char *pass, bool apSta) {
  const wifi_mode_t want = apSta ? WIFI_AP_STA : WIFI_AP;

  Serial.printf("[wifi] SoftAP start \"%s\" want=%s\n", ssid,
                apSta ? "AP_STA" : "AP");

  WiFi.mode(want);
  delay(200);

  // softAPConfig after mode is set
  WiFi.softAPConfig(SETUP_AP_IP, SETUP_AP_GW, SETUP_AP_MASK);

  // channel 1, visible, max 4 stations
  bool ok = WiFi.softAP(ssid, pass, 1, 0, 4);
  if (!ok) {
    Serial.println("[wifi] softAP() false — retry channel 6");
    delay(300);
    ok = WiFi.softAP(ssid, pass, 6, 0, 4);
  }
  if (!ok) {
    Serial.println("[wifi] softAP() false — retry open briefly then WPA");
    delay(300);
    WiFi.softAP(ssid); // open
    delay(100);
    ok = WiFi.softAP(ssid, pass, 1, 0, 4);
  }

  _apActive = ok;
  _apSsid = ssid;

  const IPAddress ip = WiFi.softAPIP();
  Serial.printf("[wifi] SoftAP \"%s\" %s ip=%s mode=%d\n", ssid,
                ok ? "OK" : "FAIL", ip.toString().c_str(), (int)WiFi.getMode());

  if (!ok) {
    Serial.println("[wifi] ERROR: SoftAP failed — hotspot will not appear");
  } else {
    notifyNetwork();
  }
}

void WifiManager::ensureSoftAp(bool apSta) {
  // Re-assert after WiFi.mode() / STA changes (ESP32 often drops SoftAP)
  if (!_apActive || WiFi.softAPIP() == IPAddress((uint32_t)0) ||
      WiFi.getMode() == WIFI_STA) {
    startSoftAp(AP_SSID, AP_PASS, apSta || isStaConnected() || _connecting);
    return;
  }
  const wifi_mode_t want =
      (apSta || isStaConnected() || _connecting) ? WIFI_AP_STA : WIFI_AP;
  if (WiFi.getMode() != want) {
    WiFi.mode(want);
    delay(100);
    WiFi.softAP(AP_SSID, AP_PASS, 1, 0, 4);
    Serial.printf("[wifi] SoftAP re-asserted after mode→%d\n", (int)want);
  }
}

void WifiManager::bootSoftAp() {
  Serial.println("[wifi] boot SoftAP…");
  startSoftAp(AP_SSID, AP_PASS, false);
  _phase = WifiPhase::DirectAp;
  _phaseStartedMs = millis();
  _connecting = false;
  setMessage("softap_up");
  emitStatus();
}

void WifiManager::startSetupAp() {
  startSoftAp(AP_SSID, AP_PASS, true);
  _phase = WifiPhase::SetupAp;
  _phaseStartedMs = millis();
  setMessage("setup_ready");
  emitStatus();
}

void WifiManager::startDirectAp() {
  WiFi.disconnect(false, false);
  delay(50);
  startSoftAp(AP_SSID, AP_PASS, false);
  _phase = WifiPhase::DirectAp;
  _phaseStartedMs = millis();
  _connecting = false;
  setMessage("direct_ready");
  Serial.println("[wifi] Direct Mode — SoftAP drive ready");
  emitStatus();
}

void WifiManager::stopSoftAp() {
  // SoftAP is permanent for this product — never tear it down.
  Serial.println("[wifi] stopSoftAp ignored (SoftAP always on)");
}

void WifiManager::enterSetup(const char *reason) {
  Serial.printf("[wifi] → Setup Mode (%s)\n", reason);
  setMessage(reason);
  startSetupAp();
}

void WifiManager::enterDirect(const char *reason) {
  Serial.printf("[wifi] → Direct Mode (%s)\n", reason);
  setMessage(reason);
  startDirectAp();
}

void WifiManager::trySavedOrFallback() {
  prefs.begin("rc-car", true);
  _ssid = prefs.getString("ssid", "");
  _pass = prefs.getString("pass", "");
  prefs.end();

  if (!_apActive) bootSoftAp();

  if (_ssid.length() == 0) {
    _phase = WifiPhase::SetupAp;
    setMessage("no_saved_wifi");
    emitStatus();
    return;
  }

  Serial.printf("[wifi] SoftAP stays up — trying home \"%s\" (%u s)\n",
                _ssid.c_str(), (unsigned)(STA_BOOT_TIMEOUT_MS / 1000));

  // Mode change can kill SoftAP — re-assert immediately
  startSoftAp(AP_SSID, AP_PASS, true);
  _phase = WifiPhase::TryingSaved;
  _phaseStartedMs = millis();
  _connecting = true;
  _connectAttempt = 0;
  emitStatus();
  beginStaAttempt();
}

void WifiManager::forgetSaved() {
  prefs.begin("rc-car", false);
  prefs.clear();
  prefs.end();
  WiFi.disconnect(false, false);
  _connecting = false;
  _ssid = "";
  _pass = "";
  enterSetup("forgot");
}

void WifiManager::disconnectSta() {
  _connecting = false;
  WiFi.disconnect(false, false);
  delay(50);
  startSoftAp(AP_SSID, AP_PASS, false);
  _phase = WifiPhase::DirectAp;
  setMessage("sta_disconnected");
  Serial.println("[wifi] STA disconnected — SoftAP only");
  notifyNetwork();
  emitStatus();
}

void WifiManager::connectAndSave(const String &ssid, const String &pass) {
  _ssid = ssid;
  _pass = pass;
  _connecting = true;
  _connectAttempt = 0;
  _lastFailReason = 0;
  gDisconnectReason = 0;

  prefs.begin("rc-car", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.putBool("ok", false);
  prefs.end();

  startSoftAp(AP_SSID, AP_PASS, true);

  _phase = WifiPhase::ConnectingSta;
  _phaseStartedMs = millis();
  setMessage("Connecting...");
  beginStaAttempt();
}

void WifiManager::beginStaAttempt() {
  _connectAttempt++;
  _attemptStartedMs = millis();
  gDisconnectReason = 0;

  if (_connectAttempt > 1) {
    setMessage(String("Retry ") + String(_connectAttempt - 1) + "...");
  } else if (_message != "Connecting...") {
    setMessage("Connecting...");
  }

  ensureSoftAp(true);
  WiFi.begin(_ssid.c_str(), _pass.c_str());
  Serial.printf("[wifi] STA begin attempt %u ssid=\"%s\"\n",
                (unsigned)_connectAttempt, _ssid.c_str());
  emitStatus();
}

void WifiManager::onStaConnected() {
  _connecting = false;
  prefs.begin("rc-car", false);
  prefs.putBool("ok", true);
  prefs.end();

  if (MDNS.begin(MDNS_HOSTNAME)) {
    MDNS.addService("http", "tcp", HTTP_PORT);
    MDNS.addService("ws", "tcp", WS_PORT);
  }

  // Keep SoftAP forever — phone can always join Porsche_RC_Car
  ensureSoftAp(true);
  _phase = WifiPhase::Connected;
  setMessage("Connected");
  Serial.printf("[wifi] Home Mode OK ip=%s (SoftAP still on)\n",
                WiFi.localIP().toString().c_str());
  notifyNetwork();
  emitStatus();
}

void WifiManager::onStaFailed(const String &error) {
  _connecting = false;
  prefs.begin("rc-car", false);
  prefs.putBool("ok", false);
  prefs.end();

  setMessage(error);
  Serial.printf("[wifi] STA fail: %s\n", error.c_str());

  if (_phase == WifiPhase::TryingSaved || !_apActive) {
    enterDirect(error.c_str());
  } else {
    _phase = WifiPhase::SetupAp;
    ensureSoftAp(false);
    JsonDocument doc;
    deserializeJson(doc, statusJson());
    doc["status"] = "failed";
    doc["wifi"] = "failed";
    doc["error"] = error;
    doc["message"] = error;
    String out;
    serializeJson(doc, out);
    if (_onStatus) _onStatus(out);
  }
}

void WifiManager::loop() {
  const uint32_t now = millis();
  const wl_status_t st = WiFi.status();

  // SoftAP watchdog — restart if it vanished
  static uint32_t lastApCheck = 0;
  if (now - lastApCheck > 5000) {
    lastApCheck = now;
    if (WiFi.softAPIP() == IPAddress((uint32_t)0) ||
        WiFi.getMode() == WIFI_OFF || WiFi.getMode() == WIFI_STA) {
      Serial.println("[wifi] SoftAP missing — restarting");
      ensureSoftAp(isStaConnected() || _connecting);
    }
  }

  if (_connecting) {
    if (st == WL_CONNECTED) {
      onStaConnected();
      return;
    }
    if (now - _attemptStartedMs >
        (_phase == WifiPhase::TryingSaved ? STA_BOOT_TIMEOUT_MS
                                          : STA_ATTEMPT_TIMEOUT_MS)) {
      _lastFailReason = gDisconnectReason;
      const bool canRetry = _phase != WifiPhase::TryingSaved &&
                            _connectAttempt < STA_CONNECT_MAX_ATTEMPTS;
      if (canRetry) {
        beginStaAttempt();
      } else {
        const char *err =
            _lastFailReason ? reasonToError(_lastFailReason) : "Timeout";
        if (st == WL_NO_SSID_AVAIL) err = "ssid_not_found";
        if (st == WL_CONNECT_FAILED) err = "Wrong password";
        if (strcmp(err, "wrong_password") == 0 || strcmp(err, "auth_fail") == 0)
          err = "Wrong password";
        if (strcmp(err, "timeout") == 0) err = "Timeout";
        onStaFailed(err);
      }
    }
    return;
  }

  if (_phase == WifiPhase::Connected && st != WL_CONNECTED) {
    Serial.println("[wifi] lost STA — Direct Mode (SoftAP)");
    enterDirect("wifi_lost");
  }
}

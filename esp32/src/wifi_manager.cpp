#include "wifi_manager.h"
#include "config.h"

#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_wifi.h>

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
  esp_wifi_set_ps(WIFI_PS_NONE);
  WiFi.onEvent(onWifiEvent);
  _phase = WifiPhase::Boot;
  setMessage("boot");
}

bool WifiManager::softApHealthy() const {
  if (!_apActive) return false;
  const IPAddress ip = WiFi.softAPIP();
  if (ip == IPAddress((uint32_t)0)) return false;
  const wifi_mode_t m = WiFi.getMode();
  return m == WIFI_AP || m == WIFI_AP_STA;
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
  // Always expose STA address separately so the phone can save it for Home Mode
  if (isStaConnected()) {
    doc["staIp"] = WiFi.localIP().toString();
    doc["ssid"] = WiFi.SSID();
  }
  if (ip.length()) {
    doc["ip"] = ip;
    doc["ws"] = String("ws://") + ip + ":" + String(WS_PORT);
    doc["stream"] = String("http://") + ip + "/stream";
    doc["jpg"] = String("http://") + ip + "/jpg";
    doc["battery"] = String("http://") + ip + "/api/battery";
  }
  if (_ssid.length() && !isStaConnected()) doc["ssid"] = _ssid;

  String out;
  serializeJson(doc, out);
  return out;
}

/** Start / re-assert SoftAP. Prefer not to drop phones mid-join. */
void WifiManager::startSoftAp(const char *ssid, const char *pass, bool apSta) {
  const wifi_mode_t want = apSta ? WIFI_AP_STA : WIFI_AP;
  const int stations = WiFi.softAPgetStationNum();
  const wifi_mode_t cur = WiFi.getMode();

  // SoftAP already healthy — avoid restart (kills "Connecting…" on phones/PCs)
  if (softApHealthy()) {
    if (cur == want) {
      return;
    }
    // Upgrade AP → AP_STA without tearing down beacon if clients present
    if (want == WIFI_AP_STA && cur == WIFI_AP) {
      Serial.printf("[wifi] SoftAP upgrade AP→AP_STA (clients=%d)\n", stations);
      WiFi.mode(WIFI_AP_STA);
      delay(80);
      esp_wifi_set_ps(WIFI_PS_NONE);
      if (!softApHealthy()) {
        WiFi.softAPConfig(SETUP_AP_IP, SETUP_AP_GW, SETUP_AP_MASK);
        WiFi.softAP(ssid, pass, _apChannel, 0, AP_MAX_CLIENTS);
      }
      _apActive = softApHealthy();
      notifyNetwork();
      return;
    }
    // Downgrade AP_STA → AP only when no STA work and no clients disruption needed
    if (want == WIFI_AP && cur == WIFI_AP_STA && !isStaConnected() &&
        !_connecting) {
      if (stations > 0) {
        Serial.println("[wifi] SoftAP keep AP_STA — clients online");
        return;
      }
    }
    if (stations > 0) {
      Serial.printf("[wifi] SoftAP skip restart (clients=%d mode=%d want=%d)\n",
                    stations, (int)cur, (int)want);
      return;
    }
  }

  Serial.printf("[wifi] SoftAP start \"%s\" want=%s ch=%u\n", ssid,
                apSta ? "AP_STA" : "AP", (unsigned)_apChannel);

  WiFi.mode(want);
  delay(120);
  esp_wifi_set_ps(WIFI_PS_NONE);
  WiFi.setTxPower(WIFI_POWER_15dBm);

  WiFi.softAPConfig(SETUP_AP_IP, SETUP_AP_GW, SETUP_AP_MASK);

  bool ok = WiFi.softAP(ssid, pass, _apChannel, 0, AP_MAX_CLIENTS);
  if (!ok) {
    Serial.println("[wifi] softAP() false — retry channel 1");
    delay(200);
    _apChannel = 1;
    ok = WiFi.softAP(ssid, pass, _apChannel, 0, AP_MAX_CLIENTS);
  }
  if (!ok) {
    Serial.println("[wifi] softAP() false — open then WPA2");
    delay(200);
    WiFi.softAP(ssid, nullptr, _apChannel, 0, AP_MAX_CLIENTS);
    delay(80);
    ok = WiFi.softAP(ssid, pass, _apChannel, 0, AP_MAX_CLIENTS);
  }

  _apActive = ok;
  _apSsid = ssid;
  if (ok) _softApUpMs = millis();

  const IPAddress ip = WiFi.softAPIP();
  Serial.printf("[wifi] SoftAP \"%s\" %s ip=%s mode=%d clients=%d\n", ssid,
                ok ? "OK" : "FAIL", ip.toString().c_str(), (int)WiFi.getMode(),
                WiFi.softAPgetStationNum());

  if (!ok) {
    Serial.println("[wifi] ERROR: SoftAP failed — hotspot will not appear");
  } else {
    notifyNetwork();
  }
}

void WifiManager::ensureSoftAp(bool apSta) {
  const bool needApSta = apSta || isStaConnected() || _connecting;
  if (!softApHealthy() || WiFi.getMode() == WIFI_STA ||
      WiFi.getMode() == WIFI_OFF) {
    startSoftAp(AP_SSID, AP_PASS, needApSta);
    return;
  }
  const wifi_mode_t want = needApSta ? WIFI_AP_STA : WIFI_AP;
  if (WiFi.getMode() != want) {
    startSoftAp(AP_SSID, AP_PASS, needApSta);
  }
}

void WifiManager::bootSoftAp() {
  Serial.println("[wifi] boot SoftAP (stable, SoftAP-first)…");
  _apChannel = AP_CHANNEL;
  startSoftAp(AP_SSID, AP_PASS, false);
  _phase = WifiPhase::DirectAp;
  _phaseStartedMs = millis();
  _connecting = false;
  _deferStaUntilMs = 0;
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
    _deferStaUntilMs = 0;
    setMessage("no_saved_wifi");
    emitStatus();
    return;
  }

  // SoftAP-first: stay Direct / drive-ready so phones can join smoothly.
  // Home Wi‑Fi scan (AP+STA) is deferred — it makes SoftAP hang on "Connecting…".
  _phase = WifiPhase::DirectAp;
  _connecting = false;
  _deferStaUntilMs = millis() + SOFTAP_SETTLE_MS;
  setMessage("softap_ready");
  Serial.printf(
      "[wifi] SoftAP first — home \"%s\" try in %u s (or when no clients)\n",
      _ssid.c_str(), (unsigned)(SOFTAP_SETTLE_MS / 1000));
  emitStatus();
}

void WifiManager::beginDeferredStaTry() {
  if (_ssid.length() == 0 || _connecting || isStaConnected()) {
    _deferStaUntilMs = 0;
    return;
  }

  const int stations = WiFi.softAPgetStationNum();
  if (stations > 0) {
    // Someone is on the hotspot — do not start STA scan (drops DHCP/auth).
    _deferStaUntilMs = millis() + SOFTAP_CLIENT_DEFER_MS;
    Serial.printf("[wifi] defer home Wi‑Fi — SoftAP clients=%d\n", stations);
    return;
  }

  _deferStaUntilMs = 0;
  Serial.printf("[wifi] SoftAP settled — trying home \"%s\"\n", _ssid.c_str());
  ensureSoftAp(true);
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
  _deferStaUntilMs = 0;
  _ssid = "";
  _pass = "";
  enterSetup("forgot");
}

void WifiManager::disconnectSta() {
  _connecting = false;
  _deferStaUntilMs = 0;
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
  _deferStaUntilMs = 0;
  gDisconnectReason = 0;

  prefs.begin("rc-car", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.putBool("ok", false);
  prefs.end();

  // Phone is already on SoftAP — upgrade gently, do not bounce beacon.
  ensureSoftAp(true);

  _phase = WifiPhase::ConnectingSta;
  _phaseStartedMs = millis();
  setMessage("Connecting...");
  beginStaAttempt();
}

void WifiManager::beginStaAttempt() {
  _connectAttempt++;
  _attemptStartedMs = millis();
  gDisconnectReason = 0;

  // During SoftAP client join, pause STA (radio busy → hang on Connecting…)
  if (_phase == WifiPhase::TryingSaved && WiFi.softAPgetStationNum() > 0) {
    Serial.println("[wifi] STA pause — SoftAP client present");
    _connecting = false;
    _deferStaUntilMs = millis() + SOFTAP_CLIENT_DEFER_MS;
    _phase = WifiPhase::DirectAp;
    setMessage("softap_busy");
    emitStatus();
    return;
  }

  if (_connectAttempt > 1) {
    setMessage(String("Retry ") + String(_connectAttempt - 1) + "...");
  } else if (_message != "Connecting...") {
    setMessage("Connecting...");
  }

  ensureSoftAp(true);
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);
  WiFi.begin(_ssid.c_str(), _pass.c_str());
  Serial.printf("[wifi] STA begin attempt %u ssid=\"%s\"\n",
                (unsigned)_connectAttempt, _ssid.c_str());
  emitStatus();
}

void WifiManager::onStaConnected() {
  _connecting = false;
  _deferStaUntilMs = 0;
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
  Serial.printf("[wifi] Home Mode OK ip=%s (SoftAP still on, clients=%d)\n",
                WiFi.localIP().toString().c_str(), WiFi.softAPgetStationNum());
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

  // SoftAP-first: delayed home Wi‑Fi try
  if (_deferStaUntilMs && now >= _deferStaUntilMs && !_connecting &&
      !isStaConnected()) {
    beginDeferredStaTry();
  }

  // SoftAP watchdog — never bounce while clients are joining/connected
  static uint32_t lastApCheck = 0;
  if (now - lastApCheck > 4000) {
    lastApCheck = now;
    const int stations = WiFi.softAPgetStationNum();
    if (!softApHealthy()) {
      if (stations > 0) {
        Serial.println("[wifi] SoftAP unhealthy but has clients — gentle fix");
        esp_wifi_set_ps(WIFI_PS_NONE);
      } else {
        Serial.println("[wifi] SoftAP missing — restarting");
        ensureSoftAp(isStaConnected() || _connecting);
      }
    } else {
      esp_wifi_set_ps(WIFI_PS_NONE);
    }
  }

  if (_connecting) {
    // If a phone just joined SoftAP mid-STA-scan, abort scan so DHCP works
    if (_phase == WifiPhase::TryingSaved && WiFi.softAPgetStationNum() > 0 &&
        st != WL_CONNECTED) {
      Serial.println("[wifi] abort STA try — SoftAP client joined");
      WiFi.disconnect(false, false);
      _connecting = false;
      _phase = WifiPhase::DirectAp;
      _deferStaUntilMs = now + SOFTAP_CLIENT_DEFER_MS;
      setMessage("softap_busy");
      ensureSoftAp(false);
      emitStatus();
      return;
    }

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

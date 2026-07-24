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
  if (WiFi.softAPIP() == IPAddress((uint32_t)0)) return false;
  const wifi_mode_t m = WiFi.getMode();
  return m == WIFI_AP || m == WIFI_AP_STA;
}

int WifiManager::softApClients() const {
  return _apActive ? (int)WiFi.softAPgetStationNum() : 0;
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
  // SoftAP clients can only reach 192.168.4.1
  if (_apActive && softApClients() > 0) return WiFi.softAPIP().toString();
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
  const String apIp = _apActive ? WiFi.softAPIP().toString() : String("");
  const String staIp = isStaConnected() ? WiFi.localIP().toString() : String("");
  const int apClients = softApClients();
  const String ip = controlIp();

  if (isHomeMode() && apClients == 0) {
    doc["mode"] = "home";
    doc["status"] = "connected";
    doc["wifi"] = "connected";
  } else if (_apActive) {
    doc["mode"] = "direct";
    doc["status"] = "connected";
    doc["wifi"] = "direct";
    if (isHomeMode()) doc["homeAlso"] = true;
  } else if (_connecting) {
    doc["mode"] = "setup";
    doc["status"] = "connecting";
    doc["wifi"] = "connecting";
  } else if (_phase == WifiPhase::SetupAp || _phase == WifiPhase::PendingHome) {
    doc["mode"] = "setup";
    doc["status"] = _phase == WifiPhase::PendingHome ? "pending_home" : "setup";
    doc["wifi"] = "setup";
  } else {
    doc["mode"] = "home";
    doc["status"] = "disconnected";
    doc["wifi"] = "disconnected";
  }

  if (_connecting) {
    doc["status"] = "connecting";
    doc["wifi"] = "connecting";
    doc["attempt"] = _connectAttempt;
  }

  doc["phase"] = static_cast<int>(_phase);
  doc["message"] = _message;
  doc["ap"] = _apActive;
  doc["apClients"] = apClients;
  doc["wantHome"] = _wantHome;
  if (_apActive) {
    doc["apSsid"] = AP_SSID;
    if (apIp.length()) doc["apIp"] = apIp;
  }
  if (staIp.length()) {
    doc["staIp"] = staIp;
    doc["ssid"] = WiFi.SSID();
  }
  if (ip.length()) {
    doc["ip"] = ip;
    doc["ws"] = String("ws://") + ip + ":" + String(WS_PORT);
    doc["stream"] = String("http://") + ip + "/jpg";
    doc["jpg"] = String("http://") + ip + "/jpg";
    doc["battery"] = String("http://") + ip + "/api/battery";
  }
  if (_ssid.length() && !isStaConnected()) doc["ssid"] = _ssid;

  String out;
  serializeJson(doc, out);
  return out;
}

void WifiManager::startSoftAp(bool apSta) {
  const wifi_mode_t want = apSta ? WIFI_AP_STA : WIFI_AP;
  const int stations = softApClients();
  const wifi_mode_t cur = WiFi.getMode();

  // Never bounce SoftAP while clients are online
  if (softApHealthy()) {
    if (cur == want) return;

    if (want == WIFI_AP_STA && cur == WIFI_AP) {
      Serial.printf("[wifi] SoftAP → AP_STA (clients=%d)\n", stations);
      WiFi.mode(WIFI_AP_STA);
      delay(50);
      esp_wifi_set_ps(WIFI_PS_NONE);
      if (!softApHealthy()) {
        WiFi.softAPConfig(SETUP_AP_IP, SETUP_AP_GW, SETUP_AP_MASK);
        WiFi.softAP(AP_SSID, AP_PASS, _apChannel, 0, AP_MAX_CLIENTS);
      }
      _apActive = softApHealthy();
      return;
    }

    if (stations > 0) {
      Serial.printf("[wifi] SoftAP keep mode=%d (clients=%d)\n", (int)cur,
                    stations);
      return;
    }
  }

  Serial.printf("[wifi] SoftAP start want=%s ch=%u\n", apSta ? "AP_STA" : "AP",
                (unsigned)_apChannel);

  WiFi.mode(want);
  delay(100);
  esp_wifi_set_ps(WIFI_PS_NONE);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.softAPConfig(SETUP_AP_IP, SETUP_AP_GW, SETUP_AP_MASK);

  bool ok = WiFi.softAP(AP_SSID, AP_PASS, _apChannel, 0, AP_MAX_CLIENTS);
  if (!ok) {
    delay(150);
    _apChannel = 1;
    ok = WiFi.softAP(AP_SSID, AP_PASS, _apChannel, 0, AP_MAX_CLIENTS);
  }

  _apActive = ok;
  _apSsid = AP_SSID;
  Serial.printf("[wifi] SoftAP %s ip=%s mode=%d\n", ok ? "OK" : "FAIL",
                WiFi.softAPIP().toString().c_str(), (int)WiFi.getMode());

  if (ok) notifyNetwork();
  else Serial.println("[wifi] ERROR: SoftAP failed");
}

void WifiManager::ensureSoftAp(bool apSta) {
  if (!softApHealthy() || WiFi.getMode() == WIFI_STA ||
      WiFi.getMode() == WIFI_OFF) {
    startSoftAp(apSta);
    return;
  }
  const wifi_mode_t want = apSta ? WIFI_AP_STA : WIFI_AP;
  if (WiFi.getMode() != want) startSoftAp(apSta);
}

void WifiManager::bootSoftAp() {
  Serial.println("[wifi] boot SoftAP-only (Direct)");
  _apChannel = AP_CHANNEL;
  startSoftAp(false); // WIFI_AP — no STA yet
  _phase = WifiPhase::DirectAp;
  _phaseStartedMs = millis();
  _connecting = false;
  _wantHome = false;
  _softApIdleSinceMs = millis();
  setMessage("softap_ready");
  emitStatus();
}

void WifiManager::startSetupAp() {
  startSoftAp(false);
  _phase = WifiPhase::SetupAp;
  _phaseStartedMs = millis();
  setMessage("setup_ready");
  emitStatus();
}

void WifiManager::startDirectAp() {
  _connecting = false;
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(false, false);
  delay(40);
  startSoftAp(false);
  _phase = WifiPhase::DirectAp;
  _phaseStartedMs = millis();
  setMessage("direct_ready");
  Serial.println("[wifi] Direct Mode — SoftAP only");
  emitStatus();
}

void WifiManager::stopSoftAp() {
  Serial.println("[wifi] stopSoftAp ignored (SoftAP always on)");
}

void WifiManager::enterSetup(const char *reason) {
  Serial.printf("[wifi] → Setup (%s)\n", reason);
  setMessage(reason);
  startSetupAp();
}

void WifiManager::enterDirect(const char *reason) {
  Serial.printf("[wifi] → Direct (%s)\n", reason);
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
    _wantHome = false;
    setMessage("no_saved_wifi");
    emitStatus();
    return;
  }

  // Keep SoftAP-only for Direct. Schedule home join only after SoftAP idle.
  _wantHome = true;
  _phase = WifiPhase::PendingHome;
  _connecting = false;
  _softApIdleSinceMs = millis();
  setMessage("softap_ready_home_pending");
  Serial.printf(
      "[wifi] SoftAP Direct ready — home \"%s\" after SoftAP idle %us\n",
      _ssid.c_str(), (unsigned)(SOFTAP_IDLE_BEFORE_STA_MS / 1000));
  emitStatus();
}

void WifiManager::forgetSaved() {
  prefs.begin("rc-car", false);
  prefs.clear();
  prefs.end();
  WiFi.disconnect(false, false);
  _connecting = false;
  _wantHome = false;
  _ssid = "";
  _pass = "";
  enterSetup("forgot");
}

void WifiManager::disconnectSta() {
  _connecting = false;
  _wantHome = false;
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(false, false);
  delay(40);
  startSoftAp(false);
  _phase = WifiPhase::DirectAp;
  setMessage("sta_disconnected");
  Serial.println("[wifi] STA dropped — SoftAP only");
  notifyNetwork();
  emitStatus();
}

void WifiManager::connectAndSave(const String &ssid, const String &pass) {
  _ssid = ssid;
  _pass = pass;
  _wantHome = true;
  _connecting = false;
  _connectAttempt = 0;
  _lastFailReason = 0;
  gDisconnectReason = 0;

  prefs.begin("rc-car", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.putBool("ok", false);
  prefs.end();

  // Do NOT start STA while phone/PC is on SoftAP — kills DHCP/WS.
  // Join after SoftAP clients leave.
  startSoftAp(false);
  _phase = WifiPhase::PendingHome;
  _softApIdleSinceMs = 0; // force wait for idle window from next client drop
  if (softApClients() == 0) _softApIdleSinceMs = millis();
  setMessage("saved_leave_hotspot_for_home");
  Serial.printf("[wifi] home creds saved \"%s\" — join after SoftAP idle\n",
                ssid.c_str());
  emitStatus();
}

void WifiManager::maybeStartHomeJoin(uint32_t now) {
  if (!_wantHome || _connecting || isStaConnected() || _ssid.length() == 0)
    return;

  const int clients = softApClients();
  if (clients > 0) {
    _softApIdleSinceMs = 0;
    return;
  }

  if (_softApIdleSinceMs == 0) {
    _softApIdleSinceMs = now;
    return;
  }

  if (now - _softApIdleSinceMs < SOFTAP_IDLE_BEFORE_STA_MS) return;
  if (_lastStaTryMs && now - _lastStaTryMs < STA_IDLE_RETRY_MS &&
      _phase != WifiPhase::PendingHome)
    return;

  _lastStaTryMs = now;
  _phase = WifiPhase::ConnectingSta;
  _connecting = true;
  _connectAttempt = 0;
  setMessage("Connecting...");
  Serial.printf("[wifi] SoftAP idle — joining home \"%s\"\n", _ssid.c_str());
  emitStatus();
  beginStaAttempt();
}

void WifiManager::beginStaAttempt() {
  _connectAttempt++;
  _attemptStartedMs = millis();
  gDisconnectReason = 0;

  if (softApClients() > 0) {
    Serial.println("[wifi] abort STA — SoftAP client present");
    _connecting = false;
    _phase = WifiPhase::PendingHome;
    setMessage("softap_busy");
    startSoftAp(false);
    emitStatus();
    return;
  }

  if (_connectAttempt > 1) {
    setMessage(String("Retry ") + String(_connectAttempt - 1) + "...");
  }

  ensureSoftAp(true); // AP_STA only when SoftAP is empty
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);
  WiFi.setAutoReconnect(true);
  WiFi.begin(_ssid.c_str(), _pass.c_str());
  Serial.printf("[wifi] STA attempt %u ssid=\"%s\"\n",
                (unsigned)_connectAttempt, _ssid.c_str());
  emitStatus();
}

void WifiManager::onStaConnected() {
  _connecting = false;
  _wantHome = true;
  prefs.begin("rc-car", false);
  prefs.putBool("ok", true);
  prefs.end();

  if (MDNS.begin(MDNS_HOSTNAME)) {
    MDNS.addService("http", "tcp", HTTP_PORT);
    MDNS.addService("ws", "tcp", WS_PORT);
  }

  ensureSoftAp(true);
  _phase = WifiPhase::Connected;
  setMessage("Connected");
  Serial.printf("[wifi] Home OK ip=%s SoftAP clients=%d\n",
                WiFi.localIP().toString().c_str(), softApClients());
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

  // Stay SoftAP Direct; keep wanting home for later idle retry
  startSoftAp(false);
  _phase = _wantHome ? WifiPhase::PendingHome : WifiPhase::DirectAp;
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

void WifiManager::loop() {
  const uint32_t now = millis();
  const wl_status_t st = WiFi.status();

  // Track SoftAP idle time
  if (softApClients() == 0) {
    if (_softApIdleSinceMs == 0) _softApIdleSinceMs = now;
  } else {
    _softApIdleSinceMs = 0;
  }

  // SoftAP health — never restart with clients
  static uint32_t lastApCheck = 0;
  if (now - lastApCheck > 5000) {
    lastApCheck = now;
    esp_wifi_set_ps(WIFI_PS_NONE);
    if (!softApHealthy() && softApClients() == 0) {
      Serial.println("[wifi] SoftAP missing — restart AP-only");
      startSoftAp(isStaConnected());
    }
  }

  if (_connecting) {
    if (softApClients() > 0 && st != WL_CONNECTED) {
      Serial.println("[wifi] SoftAP client during STA — back to SoftAP-only");
      WiFi.disconnect(false, false);
      _connecting = false;
      _phase = WifiPhase::PendingHome;
      startSoftAp(false);
      setMessage("softap_busy");
      emitStatus();
      return;
    }

    if (st == WL_CONNECTED) {
      onStaConnected();
      return;
    }

    if (now - _attemptStartedMs > STA_ATTEMPT_TIMEOUT_MS) {
      _lastFailReason = gDisconnectReason;
      if (_connectAttempt < STA_CONNECT_MAX_ATTEMPTS) {
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

  // SoftAP clients online while STA connected → SoftAP becomes flaky.
  // Drop home STA for Direct drive; rejoin when SoftAP goes idle.
  if (softApClients() > 0 && isStaConnected() && !_connecting) {
    Serial.printf("[wifi] SoftAP clients=%d — drop STA for reliable Direct\n",
                  softApClients());
    WiFi.setAutoReconnect(false);
    WiFi.disconnect(false, false);
    delay(40);
    startSoftAp(false); // WIFI_AP only
    _wantHome = _ssid.length() > 0;
    _phase = _wantHome ? WifiPhase::PendingHome : WifiPhase::DirectAp;
    _connecting = false;
    setMessage("direct_softap_only");
    emitStatus();
    return;
  }

  if (_phase == WifiPhase::Connected && st != WL_CONNECTED) {
    Serial.println("[wifi] lost home STA — SoftAP Direct");
    enterDirect("wifi_lost");
    _wantHome = _ssid.length() > 0;
    if (_wantHome) _phase = WifiPhase::PendingHome;
  }

  maybeStartHomeJoin(now);
}

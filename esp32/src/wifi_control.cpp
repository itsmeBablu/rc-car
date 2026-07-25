#include "wifi_control.h"
#include "battery_monitor.h"
#include "camera_stream.h"
#include "config.h"

#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_camera.h>
#include <esp_wifi.h>

static Preferences prefs;
static WifiControl *gWifi = nullptr;

static void sendCors(WebServer &s) {
  s.sendHeader("Access-Control-Allow-Origin", "*");
  s.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  s.sendHeader("Access-Control-Allow-Headers", "*");
}

void WifiControl::begin(BatteryMonitor *batt, CameraStream *cam, StatusFn onStatus) {
  _batt = batt;
  _cam = cam;
  _onStatus = onStatus;
  gWifi = this;

  WiFi.persistent(false);
  WiFi.setSleep(WIFI_PS_MIN_MODEM);
  loadCreds();
  startSoftAp();
  setupHttp();
  tryHomeSta();
  emitStatus();
}

void WifiControl::loadCreds() {
  prefs.begin("rc-car", true);
  _ssid = prefs.getString("ssid", "");
  _pass = prefs.getString("pass", "");
  const bool ok = prefs.getBool("ok", false);
  prefs.end();
  _staWanted = ok && _ssid.length() > 0;
}

void WifiControl::saveCreds(const String &ssid, const String &pass, bool ok) {
  prefs.begin("rc-car", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.putBool("ok", ok);
  prefs.end();
  _ssid = ssid;
  _pass = pass;
  _staWanted = ok && ssid.length() > 0;
}

void WifiControl::startSoftAp() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(AP_IP, AP_IP, IPAddress(255, 255, 255, 0));
  const bool ok = WiFi.softAP(AP_SSID, AP_PASS, 1, 0, 4);
  _apUp = ok;
  Serial.printf("[wifi] SoftAP %s — \"%s\" / %s @ %s\n", ok ? "UP" : "FAIL",
                AP_SSID, AP_PASS, softApIp().c_str());
}

String WifiControl::softApIp() const {
  return WiFi.softAPIP().toString();
}

String WifiControl::homeIp() const {
  return WiFi.localIP().toString();
}

bool WifiControl::homeConnected() const {
  return WiFi.status() == WL_CONNECTED;
}

int WifiControl::softApClients() const {
  return WiFi.softAPgetStationNum();
}

void WifiControl::setupHttp() {
  if (_httpUp) return;

  _http.on("/status", HTTP_GET, [this]() {
    sendCors(_http);
    _http.send(200, "application/json", statusJson());
  });

  _http.on("/", HTTP_GET, [this]() {
    sendCors(_http);
    String html;
    html.reserve(1200);
    html += F("<!DOCTYPE html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
              "<title>RC Car</title><style>"
              "body{font:14px system-ui;background:#111;color:#eee;margin:1.2rem}"
              "code,input{font-family:ui-monospace,monospace}"
              "a{color:#c9a227} .ok{color:#6ee7b7} .warn{color:#fbbf24}"
              "input,button{padding:.5rem;margin:.25rem 0;width:100%;box-sizing:border-box}"
              "button{background:#c9a227;border:0;color:#111;font-weight:600}"
              "</style></head><body>");
    html += F("<h1>Porsche RC Car</h1>");
    html += F("<p class=ok>SoftAP drive: join <code>");
    html += AP_SSID;
    html += F("</code> / <code>");
    html += AP_PASS;
    html += F("</code></p>");
    html += F("<p>WS control: <code>ws://");
    html += softApIp();
    html += F(":81</code></p>");
    if (homeConnected()) {
      html += F("<p class=ok>Home Wi‑Fi: <code>");
      html += WiFi.SSID();
      html += F("</code> @ <code>");
      html += homeIp();
      html += F("</code></p>");
    } else if (_staWanted) {
      html += F("<p class=warn>Home Wi‑Fi: connecting / offline</p>");
    } else {
      html += F("<p>Home Wi‑Fi: not configured</p>");
    }
    if (_batt) {
      html += F("<p>Battery: ");
      html += String(_batt->percent());
      html += F("%");
      if (_batt->charging()) html += F(" charging");
      if (_batt->full()) html += F(" full");
      html += F("</p>");
    }
    html += F("<h2>Join home Wi‑Fi (optional)</h2>"
              "<form method=POST action=/wifi>"
              "<input name=ssid placeholder='SSID (2.4 GHz)' required>"
              "<input name=pass type=password placeholder=Password>"
              "<button type=submit>Save &amp; join</button></form>"
              "<form method=POST action=/forget style='margin-top:1rem'>"
              "<button type=submit>Forget home Wi‑Fi</button></form>"
              "<p><a href=/status>JSON status</a> · <a href=/jpg>Camera JPEG</a></p>"
              "</body></html>");
    _http.send(200, "text/html", html);
  });

  _http.on("/wifi", HTTP_POST, [this]() {
    sendCors(_http);
    String ssid = _http.hasArg("ssid") ? _http.arg("ssid") : "";
    String pass = _http.hasArg("pass") ? _http.arg("pass") : "";
    ssid.trim();
    if (!ssid.length()) {
      _http.send(400, "text/plain", "ssid required");
      return;
    }
    connectHome(ssid, pass);
    _http.send(200, "text/html",
               F("<html><body style='font:14px system-ui;background:#111;color:#eee;padding:1rem'>"
                 "<p>Saved. Joining home Wi‑Fi… SoftAP stays up for drive.</p>"
                 "<p><a href=/>Back</a></p></body></html>"));
  });

  _http.on("/forget", HTTP_POST, [this]() {
    sendCors(_http);
    forgetHome();
    _http.send(200, "text/html",
               F("<html><body style='font:14px system-ui;background:#111;color:#eee;padding:1rem'>"
                 "<p>Home Wi‑Fi forgotten. SoftAP still up.</p>"
                 "<p><a href=/>Back</a></p></body></html>"));
  });

  _http.on("/wifi", HTTP_OPTIONS, [this]() {
    sendCors(_http);
    _http.send(204);
  });
  _http.on("/status", HTTP_OPTIONS, [this]() {
    sendCors(_http);
    _http.send(204);
  });

  _http.begin();
  _httpUp = true;
  Serial.printf("[http] SoftAP debug http://%s/\n", softApIp().c_str());
}

void WifiControl::ensureCamRoutes() {
  if (_camRoutes || !_cam || !_cam->isReady()) return;

  _http.on("/jpg", HTTP_GET, []() {
    if (!gWifi) return;
    WebServer &s = gWifi->http();
    sendCors(s);
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      s.send(503, "text/plain", "capture_fail");
      return;
    }
    s.sendHeader("Cache-Control", "no-store");
    s.setContentLength(fb->len);
    s.send(200, "image/jpeg", "");
    WiFiClient client = s.client();
    client.write(fb->buf, fb->len);
    esp_camera_fb_return(fb);
  });

  _http.on("/jpg", HTTP_OPTIONS, []() {
    if (!gWifi) return;
    sendCors(gWifi->http());
    gWifi->http().send(204);
  });

  // MJPEG is last priority — short bursts only; prefer /jpg polling from UI
  _http.on("/stream", HTTP_GET, []() {
    if (!gWifi) return;
    WiFiClient client = gWifi->http().client();
    client.println(F("HTTP/1.1 200 OK"));
    client.println(F("Access-Control-Allow-Origin: *"));
    client.println(F("Content-Type: multipart/x-mixed-replace; boundary=frame"));
    client.println(F("Cache-Control: no-cache"));
    client.println(F("Connection: close"));
    client.println();
    uint32_t lastMs = 0;
    uint8_t frames = 0;
    while (client.connected() && frames < 120) {
      camera_fb_t *fb = esp_camera_fb_get();
      if (!fb) {
        delay(30);
        yield();
        continue;
      }
      client.printf(
          "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
          fb->len);
      if (client.write(fb->buf, fb->len) == 0) {
        esp_camera_fb_return(fb);
        break;
      }
      client.print("\r\n");
      esp_camera_fb_return(fb);
      frames++;
      // ~5 fps — keep SoftAP + motors responsive
      uint32_t now = millis();
      if (now - lastMs < 200) delay(200 - (now - lastMs));
      lastMs = millis();
      yield();
    }
  });

  _camRoutes = true;
  _cam->markHttpAttached();
  Serial.println("[cam] /jpg + /stream on SoftAP HTTP (low priority)");
}

String WifiControl::statusJson() const {
  JsonDocument doc;
  doc["mode"] = homeConnected() ? "home+ap" : "ap";
  doc["ap"] = true;
  doc["apSsid"] = AP_SSID;
  doc["apIp"] = softApIp();
  doc["apClients"] = softApClients();
  doc["home"] = homeConnected();
  doc["savedSsid"] = _ssid;
  doc["saved"] = _staWanted;

  // SoftAP client signal (phone ↔ car hotspot)
  wifi_sta_list_t staList = {};
  if (esp_wifi_ap_get_sta_list(&staList) == ESP_OK && staList.num > 0) {
    int best = staList.sta[0].rssi;
    for (int i = 1; i < staList.num; i++) {
      if (staList.sta[i].rssi > best) best = staList.sta[i].rssi;
    }
    doc["apRssi"] = best;
  }

  if (homeConnected()) {
    doc["ssid"] = WiFi.SSID();
    doc["ip"] = homeIp();
    doc["rssi"] = WiFi.RSSI();
  } else if (_staWanted) {
    doc["ssid"] = _ssid;
    doc["home"] = false;
    doc["homeState"] = _staPausedForApClients ? "paused_for_ap" : "connecting";
  }
  doc["ws"] = String("ws://") + softApIp() + ":" + String(WS_PORT);
  if (homeConnected()) {
    doc["wsHome"] = String("ws://") + homeIp() + ":" + String(WS_PORT);
    doc["streamHome"] = String("http://") + homeIp() + "/jpg";
  }
  doc["stream"] = String("http://") + softApIp() + "/jpg";
  if (_batt) {
    doc["batt"] = _batt->percent();
    doc["mv"] = _batt->millivolts();
    doc["usb"] = _batt->usb();
    doc["charging"] = _batt->charging();
    doc["full"] = _batt->full();
  }
  String out;
  serializeJson(doc, out);
  return out;
}

void WifiControl::emitStatus() {
  if (_onStatus) _onStatus(statusJson());
}

void WifiControl::tryHomeSta() {
  if (!_staWanted || _ssid.length() == 0) return;
  if (_staPausedForApClients) return;
  beginSta();
}

void WifiControl::beginSta() {
  _staAttempt++;
  _staStartedMs = millis();
  Serial.printf("[wifi] home STA \"%s\" attempt %u\n", _ssid.c_str(),
                (unsigned)_staAttempt);
  WiFi.setSleep(WIFI_PS_MIN_MODEM);
  WiFi.begin(_ssid.c_str(), _pass.c_str());
}

void WifiControl::connectHome(const String &ssid, const String &pass) {
  saveCreds(ssid, pass, true);
  _staPausedForApClients = false;
  _staAttempt = 0;
  WiFi.disconnect(false, false);
  delay(50);
  beginSta();
  emitStatus();
}

void WifiControl::forgetHome() {
  saveCreds("", "", false);
  WiFi.disconnect(false, false);
  _staAttempt = 0;
  Serial.println("[wifi] home Wi‑Fi forgotten");
  emitStatus();
}

void WifiControl::disconnectHome() {
  WiFi.disconnect(false, false);
  Serial.println("[wifi] home STA disconnected (creds kept)");
  emitStatus();
}

void WifiControl::pauseStaForApClients(bool pause) {
  if (pause == _staPausedForApClients) return;
  _staPausedForApClients = pause;
  if (pause) {
    Serial.println("[wifi] SoftAP client — pause home STA (stay linked)");
    WiFi.disconnect(false, false);
  } else if (_staWanted) {
    Serial.println("[wifi] SoftAP empty — resume home STA");
    _staAttempt = 0;
    beginSta();
  }
}

void WifiControl::loop() {
  // SoftAP clients get exclusive radio priority for drive latency
  const int clients = softApClients();
  if (clients > 0) {
    pauseStaForApClients(true);
  } else {
    pauseStaForApClients(false);
  }

  if (_httpUp) {
    ensureCamRoutes();
    _http.handleClient();
  }

  static wl_status_t last = WL_IDLE_STATUS;
  const wl_status_t st = WiFi.status();

  if (!_staPausedForApClients && _staWanted && st == WL_CONNECTED &&
      last != WL_CONNECTED) {
    Serial.printf("[wifi] home OK %s @ %s\n", WiFi.SSID().c_str(),
                  homeIp().c_str());
    saveCreds(_ssid, _pass, true);
    if (MDNS.begin(MDNS_HOSTNAME)) {
      MDNS.addService("ws", "tcp", WS_PORT);
      MDNS.addService("http", "tcp", HTTP_PORT);
    }
    emitStatus();
  }

  if (!_staPausedForApClients && _staWanted && st != WL_CONNECTED) {
    if (millis() - _staStartedMs > 18000) {
      if (_staAttempt < 3) {
        beginSta();
      } else if (millis() - _staStartedMs > 60000) {
        _staAttempt = 0;
        beginSta();
      }
    }
  }

  if (millis() - _lastStatusLogMs > 10000) {
    _lastStatusLogMs = millis();
    Serial.printf("[wifi] ap=%s clients=%d home=%s\n", softApIp().c_str(),
                  clients,
                  homeConnected() ? homeIp().c_str() : "—");
  }

  last = st;
}

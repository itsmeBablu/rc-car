#include "wifi_control.h"
#include "wifi_drive_page.h"
#include "battery_monitor.h"
#include "camera_stream.h"
#include "config.h"

#include <ArduinoJson.h>
#include <DNSServer.h>
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
  WiFi.setSleep(WIFI_PS_NONE);
  loadCreds();
  startSoftAp();
  setupHttp();
  tryHomeSta();
  emitStatus();
}

void WifiControl::loadCreds() {
  prefs.begin("rc-car", true);
  _useSeq = prefs.getUInt("useSeq", 1);
  const String netsJson = prefs.getString("nets", "");
  const String legacySsid = prefs.getString("ssid", "");
  const String legacyPass = prefs.getString("pass", "");
  const bool legacyOk = prefs.getBool("ok", false);
  prefs.end();

  _netCount = 0;
  _activeIdx = -1;

  if (netsJson.length()) {
    JsonDocument doc;
    if (deserializeJson(doc, netsJson) == DeserializationError::Ok) {
      JsonArray arr = doc.as<JsonArray>();
      if (arr.isNull()) arr = doc["networks"].as<JsonArray>();
      for (JsonObject o : arr) {
        if (_netCount >= WIFI_NET_MAX) break;
        const String ssid = o["ssid"] | "";
        if (!ssid.length()) continue;
        _nets[_netCount].ssid = ssid;
        _nets[_netCount].pass = o["pass"] | "";
        _nets[_netCount].lastUsed = o["lastUsed"] | 0;
        if (_nets[_netCount].lastUsed >= _useSeq) {
          _useSeq = _nets[_netCount].lastUsed + 1;
        }
        _netCount++;
      }
    }
  }

  // Migrate single-slot legacy prefs once
  if (_netCount == 0 && legacyOk && legacySsid.length()) {
    _nets[0].ssid = legacySsid;
    _nets[0].pass = legacyPass;
    _nets[0].lastUsed = _useSeq++;
    _netCount = 1;
    persistNets();
  }

  if (_netCount > 0) {
    // Prefer most recently used
    int best = 0;
    for (int i = 1; i < _netCount; i++) {
      if (_nets[i].lastUsed > _nets[best].lastUsed) best = i;
    }
    _activeIdx = best;
    syncActiveFromIdx();
    _staWanted = true;
    rebuildTryOrder();
  } else {
    _ssid = "";
    _pass = "";
    _staWanted = false;
  }
}

void WifiControl::persistNets() {
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (uint8_t i = 0; i < _netCount; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["ssid"] = _nets[i].ssid;
    o["pass"] = _nets[i].pass;
    o["lastUsed"] = _nets[i].lastUsed;
  }
  String out;
  serializeJson(arr, out);
  prefs.begin("rc-car", false);
  prefs.putString("nets", out);
  prefs.putUInt("useSeq", _useSeq);
  // Keep legacy keys in sync for older tools
  if (_activeIdx >= 0 && _activeIdx < _netCount) {
    prefs.putString("ssid", _nets[_activeIdx].ssid);
    prefs.putString("pass", _nets[_activeIdx].pass);
    prefs.putBool("ok", true);
  } else {
    prefs.putString("ssid", "");
    prefs.putString("pass", "");
    prefs.putBool("ok", false);
  }
  prefs.end();
}

void WifiControl::syncActiveFromIdx() {
  if (_activeIdx >= 0 && _activeIdx < _netCount) {
    _ssid = _nets[_activeIdx].ssid;
    _pass = _nets[_activeIdx].pass;
  } else {
    _ssid = "";
    _pass = "";
  }
}

int WifiControl::findNet(const String &ssid) const {
  for (uint8_t i = 0; i < _netCount; i++) {
    if (_nets[i].ssid == ssid) return (int)i;
  }
  return -1;
}

void WifiControl::touchNet(int idx) {
  if (idx < 0 || idx >= _netCount) return;
  _nets[idx].lastUsed = _useSeq++;
  _activeIdx = idx;
  syncActiveFromIdx();
  persistNets();
}

void WifiControl::rebuildTryOrder() {
  for (uint8_t i = 0; i < _netCount; i++) _tryOrder[i] = i;
  // Sort by lastUsed desc (MRU first)
  for (uint8_t i = 0; i < _netCount; i++) {
    for (uint8_t j = i + 1; j < _netCount; j++) {
      if (_nets[_tryOrder[j]].lastUsed > _nets[_tryOrder[i]].lastUsed) {
        const uint8_t t = _tryOrder[i];
        _tryOrder[i] = _tryOrder[j];
        _tryOrder[j] = t;
      }
    }
  }
  _tryPos = 0;
}

void WifiControl::startSoftAp() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(AP_IP, AP_IP, IPAddress(255, 255, 255, 0));
  const bool ok = WiFi.softAP(AP_SSID, AP_PASS, 1, 0, 4);
  _apUp = ok;
  Serial.printf("[wifi] SoftAP %s — \"%s\" / %s @ %s\n", ok ? "UP" : "FAIL",
                AP_SSID, AP_PASS, softApIp().c_str());
  ensureDns();
}

void WifiControl::ensureDns() {
  if (!_apUp) return;
  if (_dnsRunning) {
    _dns.stop();
    _dnsRunning = false;
  }
  // Captive portal: any hostname → SoftAP IP (phone login sheet / Not Found fix)
  _dns.start(53, "*", AP_IP);
  _dnsRunning = true;
  Serial.println("[wifi] SoftAP DNS * → 192.168.4.1");
}

String WifiControl::portalHtml() const {
  String html;
  html.reserve(2000);
  html += F("<!DOCTYPE html><html><head><meta charset=utf-8>"
            "<meta name=viewport content='width=device-width,initial-scale=1'>"
            "<title>RC Car</title><style>"
            "body{font:16px system-ui;background:#111;color:#eee;margin:1.2rem;line-height:1.45}"
            "code{font-family:ui-monospace,monospace;font-size:13px}"
            "a{color:#c9a227} .ok{color:#6ee7b7} .muted{color:#aaa} .warn{color:#fbbf24}"
            ".box{border:1px solid #333;border-radius:12px;padding:1rem;margin:1rem 0;background:#1a1a1a}"
            "button{background:#c9a227;border:0;color:#111;font-weight:700;padding:.85rem 1rem;"
            "border-radius:10px;width:100%;font-size:16px;margin:.35rem 0}"
            "button.sec{background:#222;color:#eee;border:1px solid #444}"
            "</style></head><body>");
  html += F("<h1>Porsche RC Car</h1>");
  html += F("<div class=box><p class=ok><b>You are on the car hotspot.</b></p>"
            "<p>Network: <code>");
  html += AP_SSID;
  html += F("</code> / <code>");
  html += AP_PASS;
  html += F("</code><br>IP: <code>");
  html += softApIp();
  html += F("</code></p>"
            "<p class=warn>Use this HTTP cockpit (camera + drive). Home Screen / Vercel HTTPS "
            "cannot control motors.</p>"
            "<p><a href=/drive><button type=button>OPEN COCKPIT</button></a></p>"
            "<p class=muted>Same page on home Wi-Fi: <code>http://");
  if (homeConnected()) {
    html += homeIp();
  } else {
    html += F("CAR_LAN_IP");
  }
  html += F("/drive</code></p></div>");
  if (homeConnected()) {
    html += F("<div class=box><p class=ok><b>Home Wi-Fi active</b></p><p><code>");
    html += WiFi.SSID();
    html += F("</code> @ <code>");
    html += homeIp();
    html += F("</code></p>"
              "<p><a href=/drive><button type=button>Cockpit on this IP</button></a></p>"
              "<p class=muted>Phone on home Wi-Fi can also use React at "
              "<b>http://PC:3000</b> &rarr; Connect my UI.</p></div>");
  } else if (_staWanted && _ssid.length()) {
    html += F("<p class=muted>Car is trying place Wi-Fi: <code>");
    html += _ssid;
    html += F("</code></p>");
  }
  html += F("<div class=box><p class=muted>Optional — teach the car home / cafe Wi-Fi. "
            "SoftAP stays on. Saving here does not control the car.</p>"
            "<p><a href=/setup><button class=sec type=button>Wi-Fi setup for the car</button></a></p></div>");
  html += F("<p class=muted><a href=/drive>Drive</a> · <a href=/status>status</a> · "
            "<a href=/networks>saved</a></p></body></html>");
  return html;
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

  _http.on("/networks", HTTP_GET, [this]() {
    sendCors(_http);
    _http.send(200, "application/json", networksJson());
  });

  // Drive-first SoftAP landing — NO password form (stops captive-portal loops)
  _http.on("/", HTTP_GET, [this]() {
    sendCors(_http);
    _http.send(200, "text/html; charset=utf-8", portalHtml());
  });

  // Drive cockpit (live cam + controls) — SoftAP and home LAN
  _http.on("/drive", HTTP_GET, [this]() {
    sendCors(_http);
    _http.sendHeader("Cache-Control", "no-store");
    _http.send_P(200, "text/html; charset=utf-8", WIFI_DRIVE_PAGE);
  });
  // Alias for bookmarks / “app” wording
  _http.on("/app", HTTP_GET, [this]() {
    sendCors(_http);
    _http.sendHeader("Location", "/drive", true);
    _http.send(302, "text/plain", "");
  });
  _http.on("/cockpit", HTTP_GET, [this]() {
    sendCors(_http);
    _http.sendHeader("Location", "/drive", true);
    _http.send(302, "text/plain", "");
  });

  // Android / Google captive checks — 204 = "internet OK", dismiss login sheet
  auto captiveOk = [this]() {
    sendCors(_http);
    _http.send(204);
  };
  _http.on("/generate_204", HTTP_GET, captiveOk);
  _http.on("/gen_204", HTTP_GET, captiveOk);
  _http.on("/connecttest.txt", HTTP_GET, [this]() {
    sendCors(_http);
    _http.send(200, "text/plain", "OK");
  });
  // iOS captive — Success body
  _http.on("/hotspot-detect.html", HTTP_GET, [this]() {
    sendCors(_http);
    _http.send(200, "text/html",
               F("<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>"));
  });
  _http.on("/library/test/success.html", HTTP_GET, [this]() {
    sendCors(_http);
    _http.send(200, "text/html",
               F("<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>"));
  });
  _http.on("/ncsi.txt", HTTP_GET, [this]() {
    sendCors(_http);
    _http.send(200, "text/plain", "Microsoft NCSI");
  });
  _http.on("/fwlink/", HTTP_GET, [this]() {
    sendCors(_http);
    _http.sendHeader("Location", "http://192.168.4.1/", true);
    _http.send(302, "text/plain", "");
  });

  _http.on("/setup", HTTP_GET, [this]() {
    sendCors(_http);
    String html;
    html.reserve(1800);
    html += F("<!DOCTYPE html><html><head><meta charset=utf-8>"
              "<meta name=viewport content='width=device-width,initial-scale=1'>"
              "<title>Wi-Fi setup</title><style>"
              "body{font:14px system-ui;background:#111;color:#eee;margin:1.2rem}"
              "input,button{padding:.5rem;margin:.25rem 0;width:100%;box-sizing:border-box}"
              "button{background:#c9a227;border:0;color:#111;font-weight:600}"
              "a{color:#c9a227} .muted{color:#888} .ok{color:#6ee7b7}"
              "</style></head><body>");
    html += F("<p><a href=/>&larr; Back</a></p><h1>Place Wi-Fi</h1>"
              "<p class=muted>SoftAP stays on. Up to 10 saved networks. "
              "Joining a new one drops the least-recently used if full.</p>"
              "<form method=POST action=/wifi>"
              "<input name=ssid placeholder='SSID (2.4 GHz)' required autocomplete=username>"
              "<input name=pass type=password placeholder=Password autocomplete=current-password>"
              "<button type=submit>Save &amp; join</button></form>");
    if (_netCount) {
      html += F("<h2>Saved</h2><ul>");
      for (uint8_t i = 0; i < _netCount; i++) {
        html += F("<li><code>");
        html += _nets[i].ssid;
        html += F("</code>");
        if ((int)i == _activeIdx) html += F(" <span class=ok>active</span>");
        html += F("</li>");
      }
      html += F("</ul>");
    }
    html += F("<form method=POST action=/forget style='margin-top:1rem'>"
              "<button type=submit>Forget all</button></form>"
              "</body></html>");
    _http.send(200, "text/html; charset=utf-8", html);
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
    const bool wantJson =
        _http.hasArg("json") ||
        (_http.hasHeader("Accept") &&
         _http.header("Accept").indexOf("application/json") >= 0);
    if (wantJson) {
      _http.send(200, "application/json", networksJson());
      return;
    }
    _http.send(200, "text/html",
               F("<html><body style='font:14px system-ui;background:#111;color:#eee;padding:1rem'>"
                 "<p>Saved (max 10). Joining… SoftAP stays up.</p>"
                 "<p><a href=/>Back</a> · <a href=/setup>Setup</a></p></body></html>"));
  });

  _http.on("/forget", HTTP_POST, [this]() {
    sendCors(_http);
    String ssid = _http.hasArg("ssid") ? _http.arg("ssid") : "";
    ssid.trim();
    if (ssid.length()) forgetNetwork(ssid);
    else forgetAllNetworks();
    const bool wantJson =
        _http.hasArg("json") ||
        (_http.hasHeader("Accept") &&
         _http.header("Accept").indexOf("application/json") >= 0);
    if (wantJson) {
      _http.send(200, "application/json", networksJson());
      return;
    }
    _http.send(200, "text/html",
               F("<html><body style='font:14px system-ui;background:#111;color:#eee;padding:1rem'>"
                 "<p>Forgotten. SoftAP still up.</p>"
                 "<p><a href=/>Back</a></p></body></html>"));
  });

  _http.on("/networks/connect", HTTP_POST, [this]() {
    sendCors(_http);
    String ssid = _http.hasArg("ssid") ? _http.arg("ssid") : "";
    ssid.trim();
    if (!ssid.length() || !connectSaved(ssid)) {
      _http.send(404, "application/json", "{\"ok\":false,\"error\":\"not_found\"}");
      return;
    }
    _http.send(200, "application/json", networksJson());
  });

  _http.on("/scan", HTTP_GET, [this]() {
    sendCors(_http);
    WiFi.mode(WIFI_AP_STA);
    const int n = WiFi.scanNetworks(/*async=*/false, /*show_hidden=*/true);
    JsonDocument doc;
    JsonArray arr = doc["networks"].to<JsonArray>();
    if (n <= 0) {
      doc["error"] = n < 0 ? "scan_failed" : "none";
      String json;
      serializeJson(doc, json);
      WiFi.scanDelete();
      _http.send(200, "application/json", json);
      return;
    }
    const int count = n > 48 ? 48 : n;
    int idxs[48];
    for (int i = 0; i < count; i++) idxs[i] = i;
    for (int i = 0; i < count; i++) {
      for (int j = i + 1; j < count; j++) {
        if (WiFi.RSSI(idxs[j]) > WiFi.RSSI(idxs[i])) {
          const int t = idxs[i];
          idxs[i] = idxs[j];
          idxs[j] = t;
        }
      }
    }
    for (int i = 0; i < count && (int)arr.size() < 20; i++) {
      const int id = idxs[i];
      const String ssid = WiFi.SSID(id);
      if (!ssid.length()) continue;
      bool dup = false;
      for (JsonObject o : arr) {
        if (o["ssid"].as<String>() == ssid) {
          dup = true;
          break;
        }
      }
      if (dup) continue;
      JsonObject o = arr.add<JsonObject>();
      o["ssid"] = ssid;
      o["rssi"] = WiFi.RSSI(id);
      o["secure"] = WiFi.encryptionType(id) != WIFI_AUTH_OPEN;
    }
    WiFi.scanDelete();
    String json;
    serializeJson(doc, json);
    _http.send(200, "application/json", json);
  });

  auto opt = [this]() {
    sendCors(_http);
    _http.send(204);
  };
  _http.on("/wifi", HTTP_OPTIONS, opt);
  _http.on("/status", HTTP_OPTIONS, opt);
  _http.on("/scan", HTTP_OPTIONS, opt);
  _http.on("/networks", HTTP_OPTIONS, opt);
  _http.on("/forget", HTTP_OPTIONS, opt);
  _http.on("/networks/connect", HTTP_OPTIONS, opt);

  // Any unknown path (captive portal probes) → landing, not "Not Found"
  _http.onNotFound([this]() {
    sendCors(_http);
    if (_http.method() == HTTP_OPTIONS) {
      _http.send(204);
      return;
    }
    const String uri = _http.uri();
    if (uri.indexOf("generate_204") >= 0 || uri.indexOf("gen_204") >= 0) {
      _http.send(204);
      return;
    }
    _http.send(200, "text/html; charset=utf-8", portalHtml());
  });

  _http.begin();
  _httpUp = true;
  Serial.printf("[http] SoftAP http://%s/ (captive + drive-first)\n", softApIp().c_str());
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

String WifiControl::networksJson() const {
  JsonDocument doc;
  doc["ok"] = true;
  doc["max"] = WIFI_NET_MAX;
  JsonArray arr = doc["networks"].to<JsonArray>();
  for (uint8_t i = 0; i < _netCount; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["ssid"] = _nets[i].ssid;
    o["lastUsed"] = _nets[i].lastUsed;
    o["active"] = (int)i == _activeIdx;
  }
  String out;
  serializeJson(doc, out);
  return out;
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
  doc["savedCount"] = _netCount;
  doc["savedMax"] = WIFI_NET_MAX;
  doc["tryingSsid"] = (_staWanted && !homeConnected()) ? _ssid : "";
  doc["hotspot"] = AP_SSID;
  doc["hotspotIp"] = softApIp();
  doc["staAttempt"] = _staAttempt;
  doc["staPaused"] = false;
  doc["wifiMode"] = "AP_STA";
  doc["wl"] = (int)WiFi.status();

  JsonArray nets = doc["networks"].to<JsonArray>();
  for (uint8_t i = 0; i < _netCount; i++) {
    JsonObject o = nets.add<JsonObject>();
    o["ssid"] = _nets[i].ssid;
    o["lastUsed"] = _nets[i].lastUsed;
    o["active"] = (int)i == _activeIdx;
  }

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
    doc["homeState"] = "connected";
  } else if (_staWanted) {
    doc["ssid"] = _ssid;
    doc["home"] = false;
    doc["homeState"] = "connecting";
  } else {
    doc["homeState"] = "idle";
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
  if (!_staWanted || _netCount == 0) return;
  if (_staPausedForApClients) return;
  rebuildTryOrder();
  _tryPos = 0;
  beginStaAt(_tryOrder[0]);
}

void WifiControl::beginSta() {
  if (_activeIdx >= 0) beginStaAt(_activeIdx);
  else if (_netCount > 0) beginStaAt(0);
}

void WifiControl::beginStaAt(int idx) {
  if (idx < 0 || idx >= _netCount) return;
  _activeIdx = idx;
  syncActiveFromIdx();
  _staWanted = true;
  _staAttempt++;
  _staStartedMs = millis();
  Serial.printf("[wifi] home STA \"%s\" attempt %u (slot %d/%u)\n", _ssid.c_str(),
                (unsigned)_staAttempt, idx, (unsigned)_netCount);
  WiFi.setSleep(WIFI_PS_NONE);
  WiFi.begin(_ssid.c_str(), _pass.c_str());
}

void WifiControl::tryNextSta() {
  if (_netCount == 0) return;
  if (_tryPos + 1 < _netCount) {
    _tryPos++;
    _staAttempt = 0;
    beginStaAt(_tryOrder[_tryPos]);
    return;
  }
  // Full cycle done — restart from MRU
  rebuildTryOrder();
  _tryPos = 0;
  _staAttempt = 0;
  beginStaAt(_tryOrder[0]);
}

void WifiControl::connectHome(const String &ssid, const String &pass) {
  int idx = findNet(ssid);
  if (idx < 0) {
    if (_netCount >= WIFI_NET_MAX) {
      // Evict least recently used
      int lru = 0;
      for (int i = 1; i < _netCount; i++) {
        if (_nets[i].lastUsed < _nets[lru].lastUsed) lru = i;
      }
      Serial.printf("[wifi] slot full — drop LRU \"%s\"\n", _nets[lru].ssid.c_str());
      for (int i = lru; i < _netCount - 1; i++) _nets[i] = _nets[i + 1];
      _netCount--;
      if (_activeIdx == lru) _activeIdx = -1;
      else if (_activeIdx > lru) _activeIdx--;
    }
    idx = _netCount;
    _nets[idx].ssid = ssid;
    _netCount++;
  }
  _nets[idx].pass = pass;
  touchNet(idx);
  _staWanted = true;
  _staPausedForApClients = false;
  _staAttempt = 0;
  rebuildTryOrder();
  _tryPos = 0;
  WiFi.disconnect(false, false);
  delay(50);
  beginStaAt(idx);
  emitStatus();
}

bool WifiControl::connectSaved(const String &ssid) {
  const int idx = findNet(ssid);
  if (idx < 0) return false;
  touchNet(idx);
  _staWanted = true;
  _staAttempt = 0;
  rebuildTryOrder();
  _tryPos = 0;
  WiFi.disconnect(false, false);
  delay(50);
  beginStaAt(idx);
  emitStatus();
  return true;
}

void WifiControl::forgetNetwork(const String &ssid) {
  const int idx = findNet(ssid);
  if (idx < 0) return;
  const bool wasActive = homeConnected() && WiFi.SSID() == ssid;
  for (int i = idx; i < _netCount - 1; i++) _nets[i] = _nets[i + 1];
  _netCount--;
  if (_activeIdx == idx) _activeIdx = _netCount ? 0 : -1;
  else if (_activeIdx > idx) _activeIdx--;
  syncActiveFromIdx();
  _staWanted = _netCount > 0;
  persistNets();
  rebuildTryOrder();
  if (wasActive || !_staWanted) {
    WiFi.disconnect(false, false);
  }
  if (_staWanted) {
    _staAttempt = 0;
    tryHomeSta();
  }
  Serial.printf("[wifi] forgot \"%s\" (%u left)\n", ssid.c_str(),
                (unsigned)_netCount);
  emitStatus();
}

void WifiControl::forgetAllNetworks() {
  _netCount = 0;
  _activeIdx = -1;
  _ssid = "";
  _pass = "";
  _staWanted = false;
  _staAttempt = 0;
  persistNets();
  WiFi.disconnect(false, false);
  Serial.println("[wifi] forgot all place Wi‑Fi");
  emitStatus();
}

void WifiControl::disconnectHome() {
  WiFi.disconnect(false, false);
  Serial.println("[wifi] home STA disconnected (creds kept)");
  emitStatus();
}

void WifiControl::pauseStaForApClients(bool pause) {
  (void)pause;
  _staPausedForApClients = false;
}

void WifiControl::loop() {
  if (_dnsRunning) _dns.processNextRequest();

  if (_httpUp) {
    ensureCamRoutes();
    _http.handleClient();
  }

  // Keep SoftAP DNS alive if SoftAP restarted
  if (_apUp && !_dnsRunning) ensureDns();

  static wl_status_t last = WL_IDLE_STATUS;
  const wl_status_t st = WiFi.status();

  if (_staWanted && st == WL_CONNECTED && last != WL_CONNECTED) {
    Serial.printf("[wifi] home OK %s @ %s\n", WiFi.SSID().c_str(),
                  homeIp().c_str());
    const int idx = findNet(WiFi.SSID());
    if (idx >= 0) touchNet(idx);
    if (MDNS.begin(MDNS_HOSTNAME)) {
      MDNS.addService("ws", "tcp", WS_PORT);
      MDNS.addService("http", "tcp", HTTP_PORT);
    }
    emitStatus();
  }

  if (_staWanted && st != WL_CONNECTED && _netCount > 0) {
    if (millis() - _staStartedMs > 16000) {
      Serial.println("[wifi] STA timeout — try next saved network");
      tryNextSta();
    }
  }

  if (millis() - _lastStatusLogMs > 10000) {
    _lastStatusLogMs = millis();
    Serial.printf("[wifi] ap=%s clients=%d home=%s nets=%u wl=%d\n",
                  softApIp().c_str(), softApClients(),
                  homeConnected() ? homeIp().c_str() : "—",
                  (unsigned)_netCount, (int)st);
  }

  last = st;
}

#include "setup_server.h"
#include "battery_monitor.h"
#include "camera_stream.h"
#include "config.h"
#include "wifi_manager.h"

#include <ArduinoJson.h>
#include <WiFi.h>

void SetupServer::begin(WifiManager *wifi, CameraStream *camera,
                        BatteryMonitor *battery) {
  _wifi = wifi;
  _camera = camera;
  _battery = battery;
  registerRoutes();
  // WiFi SoftAP must already be up (lwIP ready) before this
  _http.begin();
  _running = true;
  syncDns();
  Serial.printf("[http] :%u on %s\n", HTTP_PORT,
                _wifi ? _wifi->controlIp().c_str() : "?");
}

void SetupServer::rebind() {
  if (!_running) return;
  _http.stop();
  delay(30);
  _http.begin();
  syncDns();
  const String ip = _wifi ? _wifi->controlIp() : WiFi.softAPIP().toString();
  Serial.printf("[http] rebound — http://%s/\n", ip.c_str());
}

void SetupServer::syncDns() {
  if (_wifi && _wifi->isApActive()) {
    if (!_dnsRunning) {
      _dns.start(53, "*", SETUP_AP_IP);
      _dnsRunning = true;
      Serial.println("[http] SoftAP DNS * → 192.168.4.1");
    }
  } else if (_dnsRunning) {
    _dns.stop();
    _dnsRunning = false;
  }
}

void SetupServer::loop() {
  if (_dnsRunning) _dns.processNextRequest();
  if (_running) _http.handleClient();
}

void SetupServer::sendCors() {
  _http.sendHeader("Access-Control-Allow-Origin", "*");
  _http.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  _http.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  _http.sendHeader("Access-Control-Allow-Private-Network", "true");
}

void SetupServer::handleOptions() {
  sendCors();
  _http.send(204);
}

void SetupServer::handleRoot() {
  sendCors();
  const bool ap = _wifi && _wifi->isApActive();
  const bool setup = _wifi && _wifi->isSetupMode() &&
                     !_wifi->isDirectMode() &&
                     _wifi->phase() != WifiPhase::TryingSaved;
  const char *apName =
      !ap ? "—" : (setup ? SETUP_AP_SSID : DIRECT_AP_SSID);
  String json = _wifi ? _wifi->statusJson() : "{}";

  String html;
  html.reserve(900);
  html += F("<!DOCTYPE html><html><head><meta charset=utf-8>"
            "<meta name=viewport content=\"width=device-width,initial-scale=1\">"
            "<title>RC Car</title><style>"
            "body{font-family:system-ui,sans-serif;background:#0a0b0d;color:#f2f2ec;"
            "padding:1.25rem;max-width:28rem;margin:0 auto}"
            "h1{color:#f5e000;letter-spacing:.12em;font-size:1.1rem}"
            "pre{background:#15171c;padding:.75rem;border-radius:.5rem;"
            "overflow:auto;font-size:.7rem;line-height:1.4}"
            "p{color:#aaa;font-size:.85rem;line-height:1.45}"
            "code{color:#f5e000}</style></head><body>");
  html += F("<h1>RC CAR ONLINE</h1>");
  html += F("<p>SoftAP <code>");
  html += apName;
  html += F("</code> · open your GT2 RS app on this Wi‑Fi, then Link → Direct.</p>");
  html += F("<pre id=s>");
  html += json;
  html += F("</pre>");
  html += F("<p><a style=\"color:#f5e000\" href=\"/api/status\">/api/status</a></p>");
  html += F("</body></html>");

  _http.send(200, "text/html", html);
}

void SetupServer::handleStatus() {
  sendCors();
  if (!_wifi) {
    _http.send(500, "application/json", "{\"error\":\"no_wifi\"}");
    return;
  }
  _http.send(200, "application/json", _wifi->statusJson());
}

void SetupServer::handleBattery() {
  sendCors();
  if (!_battery) {
    _http.send(503, "application/json", "{\"error\":\"no_battery\"}");
    return;
  }
  _http.send(200, "application/json", _battery->statusJson());
}

void SetupServer::handleWifiPost() {
  sendCors();
  if (!_wifi) {
    _http.send(500, "application/json", "{\"ok\":false,\"error\":\"no_wifi\"}");
    return;
  }

  String raw = _postBody;
  if (raw.length() == 0 && _http.hasArg("plain")) raw = _http.arg("plain");

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, raw);
  if (err) {
    if (_http.hasArg("ssid")) {
      doc.clear();
      doc["ssid"] = _http.arg("ssid");
      doc["password"] = _http.arg("password");
    } else if (_http.hasArg("cmd")) {
      doc.clear();
      doc["cmd"] = _http.arg("cmd");
    } else {
      _http.send(400, "application/json",
                 "{\"ok\":false,\"error\":\"bad_json\"}");
      return;
    }
  }

  const String cmd = doc["cmd"] | "";
  if (cmd == "forget") {
    _wifi->forgetSaved();
    _http.send(200, "application/json",
               "{\"ok\":true,\"message\":\"Home Wi‑Fi forgotten\"}");
    return;
  }
  if (cmd == "disconnect") {
    _wifi->disconnectSta();
    _http.send(200, "application/json",
               "{\"ok\":true,\"message\":\"Dropped home Wi‑Fi\"}");
    return;
  }

  const String ssid = doc["ssid"] | "";
  const String pass = doc["password"] | doc["pass"] | "";
  if (ssid.length() == 0) {
    _http.send(400, "application/json",
               "{\"ok\":false,\"error\":\"ssid_required\"}");
    return;
  }

  Serial.printf("[http] provision ssid=\"%s\"\n", ssid.c_str());
  _wifi->connectAndSave(ssid, pass);

  JsonDocument resp;
  resp["ok"] = true;
  resp["message"] = "Connecting...";
  resp["ssid"] = ssid;
  String out;
  serializeJson(resp, out);
  _http.send(200, "application/json", out);
}

void SetupServer::handleCaptive() {
  sendCors();
  _http.sendHeader("Location", String("http://") + SETUP_AP_IP.toString() + "/");
  _http.send(302, "text/plain", "Redirect");
}

void SetupServer::registerRoutes() {
  if (_routesRegistered) return;
  _routesRegistered = true;

  _http.on("/", HTTP_OPTIONS, [this]() { handleOptions(); });
  _http.on("/api/status", HTTP_OPTIONS, [this]() { handleOptions(); });
  _http.on("/api/wifi", HTTP_OPTIONS, [this]() { handleOptions(); });
  _http.on("/api/battery", HTTP_OPTIONS, [this]() { handleOptions(); });
  _http.on("/jpg", HTTP_OPTIONS, [this]() { handleOptions(); });
  _http.on("/stream", HTTP_OPTIONS, [this]() { handleOptions(); });

  _http.on("/", HTTP_GET, [this]() { handleRoot(); });
  _http.on("/api/status", HTTP_GET, [this]() { handleStatus(); });
  _http.on("/api/battery", HTTP_GET, [this]() { handleBattery(); });
  _http.on(
      "/api/wifi", HTTP_POST,
      [this]() { handleWifiPost(); },
      [this]() {
        HTTPUpload &up = _http.upload();
        if (up.status == UPLOAD_FILE_START) {
          _postBody = "";
        } else if (up.status == UPLOAD_FILE_WRITE) {
          _postBody += String((const char *)up.buf, up.currentSize);
        }
      });

  _http.on("/generate_204", HTTP_GET, [this]() { handleCaptive(); });
  _http.on("/hotspot-detect.html", HTTP_GET, [this]() { handleCaptive(); });
  _http.on("/connecttest.txt", HTTP_GET, [this]() { handleCaptive(); });
  _http.on("/ncsi.txt", HTTP_GET, [this]() { handleCaptive(); });

  if (_camera) _camera->attachRoutes(_http);
}

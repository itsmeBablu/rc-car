#include "websocket_control.h"
#include <ArduinoJson.h>
#include <WiFi.h>

static WebsocketControl *gWsPump = nullptr;

void WebsocketControl::begin(ServoControl *servo, MotorControl *motors) {
  if (_running) return;
  _servo = servo;
  _motors = motors;
  gWsPump = this;

  _ws.onEvent([this](uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
    this->onEvent(num, type, payload, length);
  });
  _ws.begin();
  _running = true;
  Serial.printf("[ws] control ready — SoftAP ws://%s:%u (and home IP if linked)\n",
                WiFi.softAPIP().toString().c_str(), WS_PORT);
}

void WebsocketControl::pump() {
  if (_running) _ws.loop();
}

bool WebsocketControl::preferControl() const {
  if (_motorsLive) return true;
  const uint32_t now = millis();
  return (now - _lastSteerMs < 80) || (now - _lastDriveMs < 80);
}

void WebsocketControl::failsafeStop(const char *reason) {
  if (_motors) _motors->stop();
  _motorsLive = false;
  Serial.printf("[ws] failsafe STOP (%s)\n", reason ? reason : "?");
}

void WebsocketControl::loop() {
  if (!_running) return;
  _ws.loop();

  if (_motorsLive && (millis() - _lastDriveMs > DRIVE_FAILSAFE_MS)) {
    failsafeStop("drive timeout");
  }
}

void WebsocketControl::broadcast(const String &json) {
  if (!_running) return;
  String payload = json;
  _ws.broadcastTXT(payload);
}

uint8_t WebsocketControl::clientCount() const {
  return _running ? 1 : 0;
}

void WebsocketControl::onEvent(uint8_t num, WStype_t type, uint8_t *payload,
                               size_t length) {
  switch (type) {
  case WStype_CONNECTED:
    Serial.printf("[ws] client #%u linked\n", num);
    _ws.sendTXT(num, "{\"ok\":true,\"link\":true}");
    break;

  case WStype_DISCONNECTED:
    Serial.printf("[ws] client #%u gone — STOP\n", num);
    if (_servo) _servo->setAngleImmediate(SERVO_CENTER);
    failsafeStop("disconnect");
    break;

  case WStype_TEXT: {
    String msg;
    msg.reserve(length + 1);
    for (size_t i = 0; i < length; i++) msg += (char)payload[i];
    handleMessage(num, msg.c_str());
    break;
  }

  default:
    break;
  }
}

void WebsocketControl::handleMessage(uint8_t num, const char *msg) {
  JsonDocument doc;
  if (deserializeJson(doc, msg)) {
    return; // drop bad frames — don't block control
  }

  const char *cmd = doc["cmd"] | "";

  // Priority: connection keepalive → servo → motors → (camera is HTTP, not here)
  if (strcmp(cmd, "ping") == 0) {
    _ws.sendTXT(num, "{\"ok\":true}");
    return;
  }

  if (strcmp(cmd, "steer") == 0 && doc["angle"].is<int>() && _servo) {
    _servo->setAngleImmediate(doc["angle"].as<int>());
    _lastSteerMs = millis();
    return;
  }
  if (doc["steer"].is<int>() && _servo) {
    _servo->setAngleImmediate(doc["steer"].as<int>());
    _lastSteerMs = millis();
    return;
  }
  if (strcmp(cmd, "center") == 0 && _servo) {
    _servo->setAngleImmediate(SERVO_CENTER);
    _lastSteerMs = millis();
    _ws.sendTXT(num, "{\"ok\":true}");
    return;
  }

  if (strcmp(cmd, "drive") == 0 && _motors) {
    const int left = doc["left"] | 0;
    const int right = doc["right"] | 0;
    _motors->setBoth(left, right);
    _lastDriveMs = millis();
    _motorsLive = (left != 0 || right != 0);
    return;
  }

  if (strcmp(cmd, "stop") == 0) {
    if (_servo) _servo->setAngleImmediate(SERVO_CENTER);
    failsafeStop("stop cmd");
    _lastDriveMs = millis();
    _ws.sendTXT(num, "{\"ok\":true}");
    return;
  }

  if (strcmp(cmd, "lights") == 0) {
    _ws.sendTXT(num, "{\"ok\":true}");
    return;
  }
}

void wsPumpFromHttp() {
  if (gWsPump) gWsPump->pump();
}

bool wsPreferControl() {
  return gWsPump && gWsPump->preferControl();
}

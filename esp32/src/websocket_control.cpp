#include "websocket_control.h"
#include "driving_mode.h"
#include <ArduinoJson.h>
#include <WiFi.h>

void WebsocketControl::logListen() {
  String ip = WiFi.localIP().toString();
  if (ip == "0.0.0.0" || ip.length() == 0) {
    ip = WiFi.softAPIP().toString();
  }
  Serial.printf("[ws] listening on ws://%s:%u (drive priority)\n", ip.c_str(),
                WS_PORT);
}

void WebsocketControl::emergencyStop(const char *reason) {
  if (_motors) _motors->stop();
  if (_servo) _servo->setAngleImmediate(SERVO_CENTER);
  _watchdogArmed = false;
  Serial.printf("[ws] E-STOP — %s\n", reason);
}

void WebsocketControl::begin(ServoControl *servo, MotorControl *motors,
                             DrivingModeManager *modes) {
  _servo = servo;
  _motors = motors;
  _modes = modes;

  if (!_handlerSet) {
    _ws.onEvent([this](uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
      this->onEvent(num, type, payload, length);
    });
    _handlerSet = true;
  }

  if (_running) return;
  _ws.begin();
  _running = true;
  logListen();
}

void WebsocketControl::rebind() {
  if (_running) {
    _ws.close();
    _running = false;
    delay(20);
  }
  _clients = 0;
  _watchdogArmed = false;
  if (!_handlerSet) {
    _ws.onEvent([this](uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
      this->onEvent(num, type, payload, length);
    });
    _handlerSet = true;
  }
  _ws.begin();
  _running = true;
  logListen();
}

void WebsocketControl::loop() {
  if (!_running) return;
  _ws.loop();

  if (_watchdogArmed && _clients > 0 &&
      (millis() - _lastCmdMs > WS_CMD_WATCHDOG_MS)) {
    emergencyStop("watchdog");
  }
}

void WebsocketControl::broadcast(const String &json) {
  if (!_running || _clients == 0) return;
  String payload = json;
  _ws.broadcastTXT(payload);
}

void WebsocketControl::onEvent(uint8_t num, WStype_t type, uint8_t *payload,
                               size_t length) {
  switch (type) {
  case WStype_CONNECTED: {
    Serial.printf("[ws] client #%u connected\n", num);
    if (_clients < 255) _clients++;
    _lastCmdMs = millis();
    _watchdogArmed = false;
    String hello = "{\"ok\":true,\"link\":\"ws\",\"servo\":";
    hello += String(_servo ? _servo->getAngle() : SERVO_CENTER);
    if (_modes) {
      hello += ",\"mode\":\"";
      hello += driveModeName(_modes->mode());
      hello += "\"";
    }
    hello += "}";
    _ws.sendTXT(num, hello);
    break;
  }

  case WStype_DISCONNECTED:
    Serial.printf("[ws] client #%u disconnected — stop\n", num);
    if (_clients > 0) _clients--;
    if (_clients == 0) emergencyStop("disconnect");
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
    _ws.sendTXT(num, "{\"ok\":false,\"error\":\"bad_json\"}");
    return;
  }

  // Driving mode: {"mode":"SPORT"} (also accept cmd)
  if (doc["mode"].is<const char *>() ||
      (doc["cmd"].is<const char *>() && strcmp(doc["cmd"] | "", "mode") == 0)) {
    const char *modeStr = doc["mode"] | "";
    if (!modeStr[0] && doc["value"].is<const char *>())
      modeStr = doc["value"] | "";
    if (_modes && _modes->setMode(String(modeStr))) {
      _lastCmdMs = millis();
      String out = "{\"ok\":true,\"mode\":\"";
      out += driveModeName(_modes->mode());
      out += "\"}";
      _ws.sendTXT(num, out);
      _ws.broadcastTXT(String("{\"mode\":\"") + driveModeName(_modes->mode()) +
                       "\"}");
    } else {
      _ws.sendTXT(num, "{\"ok\":false,\"error\":\"bad_mode\"}");
    }
    return;
  }

  const char *cmd = doc["cmd"] | "";
  bool isDriveCmd = false;
  bool ack = true;

  if (strcmp(cmd, "steer") == 0 && doc["angle"].is<int>() && _servo) {
    _servo->setAngle(doc["angle"].as<int>());
    isDriveCmd = true;
    ack = false;
  } else if (doc["steer"].is<int>() && _servo) {
    _servo->setAngle(doc["steer"].as<int>());
    isDriveCmd = true;
    ack = false;
  } else if (strcmp(cmd, "center") == 0 && _servo) {
    _servo->setAngle(SERVO_CENTER);
    isDriveCmd = true;
  } else if (strcmp(cmd, "drive") == 0 && _motors) {
    _motors->setBoth(doc["left"] | 0, doc["right"] | 0);
    isDriveCmd = true;
    ack = false;
  } else if (strcmp(cmd, "stop") == 0) {
    if (_motors) _motors->stop();
    if (_servo) _servo->setAngleImmediate(SERVO_CENTER);
    isDriveCmd = true;
    _watchdogArmed = false;
  } else if (strcmp(cmd, "lights") == 0) {
    bool on = doc["on"] | false;
    Serial.printf("[ws] lights %s (wire LED pin later)\n", on ? "ON" : "OFF");
  } else if (strcmp(cmd, "ping") == 0) {
    _lastCmdMs = millis();
    return;
  } else {
    _ws.sendTXT(num, "{\"ok\":false,\"error\":\"unknown_cmd\"}");
    return;
  }

  if (isDriveCmd) {
    _lastCmdMs = millis();
    if (strcmp(cmd, "stop") != 0) _watchdogArmed = true;
  }

  if (!ack) return;

  String out = "{\"ok\":true,\"servo\":" +
               String(_servo ? _servo->getAngle() : 0) +
               ",\"left\":" + String(_motors ? _motors->left() : 0) +
               ",\"right\":" + String(_motors ? _motors->right() : 0) + "}";
  _ws.sendTXT(num, out);
}

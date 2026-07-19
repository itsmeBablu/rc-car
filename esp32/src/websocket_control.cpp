#include "websocket_control.h"
#include <ArduinoJson.h>
#include <WiFi.h>

void WebsocketControl::begin(ServoControl *servo, MotorControl *motors) {
  if (_running) return;
  _servo = servo;
  _motors = motors;

  _ws.onEvent([this](uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
    this->onEvent(num, type, payload, length);
  });
  _ws.begin();
  _running = true;
  Serial.printf("[ws] listening on ws://%s:%u\n",
                WiFi.localIP().toString().c_str(), WS_PORT);
}

void WebsocketControl::loop() {
  if (_running) _ws.loop();
}

void WebsocketControl::onEvent(uint8_t num, WStype_t type, uint8_t *payload,
                               size_t length) {
  switch (type) {
  case WStype_CONNECTED:
    Serial.printf("[ws] client #%u connected\n", num);
    _ws.sendTXT(num, "{\"ok\":true,\"servo\":" + String(_servo->getAngle()) + "}");
    break;

  case WStype_DISCONNECTED:
    Serial.printf("[ws] client #%u disconnected — stop\n", num);
    if (_servo) _servo->setAngle(SERVO_CENTER);
    if (_motors) _motors->stop();
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

  const char *cmd = doc["cmd"] | "";

  if (strcmp(cmd, "steer") == 0 && doc["angle"].is<int>() && _servo) {
    _servo->setAngle(doc["angle"].as<int>());
  } else if (doc["steer"].is<int>() && _servo) {
    _servo->setAngle(doc["steer"].as<int>());
  } else if (strcmp(cmd, "center") == 0 && _servo) {
    _servo->setAngle(SERVO_CENTER);
  } else if (strcmp(cmd, "drive") == 0 && _motors) {
    _motors->setBoth(doc["left"] | 0, doc["right"] | 0);
  } else if (strcmp(cmd, "stop") == 0) {
    if (_motors) _motors->stop();
    if (_servo) _servo->setAngle(SERVO_CENTER);
  } else if (strcmp(cmd, "lights") == 0) {
    bool on = doc["on"] | false;
    Serial.printf("[ws] lights %s (wire LED pin later)\n", on ? "ON" : "OFF");
  } else {
    _ws.sendTXT(num, "{\"ok\":false,\"error\":\"unknown_cmd\"}");
    return;
  }

  String ack = "{\"ok\":true,\"servo\":" + String(_servo ? _servo->getAngle() : 0) +
               ",\"left\":" + String(_motors ? _motors->left() : 0) +
               ",\"right\":" + String(_motors ? _motors->right() : 0) + "}";
  _ws.sendTXT(num, ack);
}

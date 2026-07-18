#pragma once

#include <WebSocketsServer.h>
#include "config.h"
#include "motor_control.h"
#include "servo_control.h"

class WebsocketControl {
public:
  void begin(ServoControl *servo, MotorControl *motors);
  void loop();
  bool isRunning() const { return _running; }

private:
  WebSocketsServer _ws{WS_PORT};
  ServoControl *_servo = nullptr;
  MotorControl *_motors = nullptr;
  bool _running = false;

  void onEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length);
  void handleMessage(uint8_t num, const char *msg);
};

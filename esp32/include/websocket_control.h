#pragma once

#include <WebSocketsServer.h>
#include "config.h"
#include "motor_control.h"
#include "servo_control.h"

class WebsocketControl {
public:
  void begin(ServoControl *servo, MotorControl *motors);
  /** Restart listener after SoftAP / STA change. */
  void rebind();
  void loop();
  bool isRunning() const { return _running; }
  /** Push telemetry JSON to all clients (battery, etc.). */
  void broadcast(const String &json);

private:
  WebSocketsServer _ws{WS_PORT};
  ServoControl *_servo = nullptr;
  MotorControl *_motors = nullptr;
  bool _running = false;
  bool _handlerSet = false;

  void onEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length);
  void handleMessage(uint8_t num, const char *msg);
  void logListen();
};

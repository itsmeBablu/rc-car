#pragma once

#include <WebSocketsServer.h>
#include "config.h"
#include "motor_control.h"
#include "servo_control.h"

class DrivingModeManager;

class WebsocketControl {
public:
  void begin(ServoControl *servo, MotorControl *motors,
             DrivingModeManager *modes = nullptr);
  /** Restart listener after SoftAP / STA change. */
  void rebind();
  void loop();
  bool isRunning() const { return _running; }
  bool hasClient() const { return _clients > 0; }
  /** Push telemetry JSON to all clients (battery, etc.). Never camera. */
  void broadcast(const String &json);

private:
  WebSocketsServer _ws{WS_PORT};
  ServoControl *_servo = nullptr;
  MotorControl *_motors = nullptr;
  DrivingModeManager *_modes = nullptr;
  bool _running = false;
  bool _handlerSet = false;
  uint8_t _clients = 0;
  uint32_t _lastCmdMs = 0;
  bool _watchdogArmed = false;

  void onEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length);
  void handleMessage(uint8_t num, const char *msg);
  void emergencyStop(const char *reason);
  void logListen();
};

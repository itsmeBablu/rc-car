#pragma once

#include <WebSocketsServer.h>
#include "config.h"
#include "motor_control.h"
#include "servo_control.h"

/** Stop motors if no drive command arrives within this window. */
static const uint32_t DRIVE_FAILSAFE_MS = 320;

class WebsocketControl {
public:
  void begin(ServoControl *servo, MotorControl *motors);
  void loop();
  bool isRunning() const { return _running; }
  void broadcast(const String &json);
  uint8_t clientCount() const;
  void pump();
  /** True when phone is actively driving — HTTP /jpg should yield. */
  bool preferControl() const;

private:
  WebSocketsServer _ws{WS_PORT};
  ServoControl *_servo = nullptr;
  MotorControl *_motors = nullptr;
  bool _running = false;
  uint32_t _lastDriveMs = 0;
  uint32_t _lastSteerMs = 0;
  bool _motorsLive = false;

  void onEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length);
  void handleMessage(uint8_t num, const char *msg);
  void failsafeStop(const char *reason);
};

void wsPumpFromHttp();
bool wsPreferControl();

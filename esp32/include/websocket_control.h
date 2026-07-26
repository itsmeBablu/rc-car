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
  /** Broadcast JSON to all clients (battery / status) — low rate. */
  void broadcast(const String &json);
  uint8_t clientCount() const;
  /** Call from long HTTP handlers so control stays alive during /jpg. */
  void pump();

private:
  WebSocketsServer _ws{WS_PORT};
  ServoControl *_servo = nullptr;
  MotorControl *_motors = nullptr;
  bool _running = false;
  uint32_t _lastDriveMs = 0;
  bool _motorsLive = false;

  void onEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length);
  void handleMessage(uint8_t num, const char *msg);
  void failsafeStop(const char *reason);
};

/** Keep WS responsive during long /jpg writes. */
void wsPumpFromHttp();

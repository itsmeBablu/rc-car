#pragma once

#include <ESP32Servo.h>
#include "config.h"

class ServoControl {
public:
  void begin();
  /** Commanded angle 0–180; clamped by profile max steer %. */
  void setAngle(int degrees);
  /** Snap immediately (E-stop / disconnect). */
  void setAngleImmediate(int degrees);
  void setProfile(uint8_t maxSteerPct, uint8_t servoSpeed);
  void loop();
  int getAngle() const { return _angle; }
  int targetAngle() const { return _target; }

private:
  Servo _servo;
  int _angle = SERVO_CENTER;
  int _target = SERVO_CENTER;
  uint8_t _maxSteerPct = 80;
  uint8_t _servoSpeed = 4;
  uint32_t _lastMs = 0;

  int clampSteer(int degrees) const;
};

#pragma once

#include <ESP32Servo.h>
#include "config.h"

class ServoControl {
public:
  void begin();
  void setAngle(int degrees);
  int getAngle() const { return _angle; }

private:
  Servo _servo;
  int _angle = SERVO_CENTER;
};

#pragma once

#include <Arduino.h>

class MotorControl {
public:
  void begin();
  /** speed -255..255 ; 0 = coast/stop */
  void setLeft(int speed);
  void setRight(int speed);
  void setBoth(int left, int right);
  void stop();
  int left() const { return _left; }
  int right() const { return _right; }

private:
  int _left = 0;
  int _right = 0;
  void writeBridge(int in1, int in2, int speed);
};

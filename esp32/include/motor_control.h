#pragma once

#include <Arduino.h>

class MotorControl {
public:
  void begin();
  /** Commanded speed -255..255 (profile scales + ramps). 0 = stop. */
  void setLeft(int speed);
  void setRight(int speed);
  void setBoth(int left, int right);
  void stop();
  /** From DrivingProfile — applied immediately. */
  void setProfile(uint8_t maxPwm, uint8_t accelRate, uint8_t brakeStrength);
  /** Soft accel/brake ramp — call often from drive loop. */
  void loop();
  int left() const { return _left; }
  int right() const { return _right; }
  int targetLeft() const { return _targetLeft; }
  int targetRight() const { return _targetRight; }

private:
  int _left = 0;
  int _right = 0;
  int _cmdLeft = 0;
  int _cmdRight = 0;
  int _targetLeft = 0;
  int _targetRight = 0;
  uint8_t _maxPwm = 178;
  uint8_t _accel = 6;
  uint8_t _brake = 14;
  uint32_t _lastRampMs = 0;
  bool _pwmOk = false;

  int scaleCommand(int speed) const;
  int stepToward(int current, int target) const;
  void writeBridge(int inPos, int inNeg, int speed);
  void applyOutputs();
};

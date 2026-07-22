#include "servo_control.h"

void ServoControl::begin() {
  _servo.setPeriodHertz(50);
  _servo.attach(SERVO_PIN, 500, 2400);
  setAngleImmediate(SERVO_CENTER);
  Serial.printf("[servo] ready on pin D4, centered at %d°\n", SERVO_CENTER);
}

int ServoControl::clampSteer(int degrees) const {
  if (degrees < SERVO_MIN) degrees = SERVO_MIN;
  if (degrees > SERVO_MAX) degrees = SERVO_MAX;
  const int half = ((SERVO_MAX - SERVO_MIN) / 2 * (int)_maxSteerPct) / 100;
  const int lo = SERVO_CENTER - half;
  const int hi = SERVO_CENTER + half;
  if (degrees < lo) return lo;
  if (degrees > hi) return hi;
  return degrees;
}

void ServoControl::setProfile(uint8_t maxSteerPct, uint8_t servoSpeed) {
  _maxSteerPct = maxSteerPct ? maxSteerPct : 1;
  _servoSpeed = servoSpeed ? servoSpeed : 1;
  _target = clampSteer(_target);
}

void ServoControl::setAngle(int degrees) {
  _target = clampSteer(degrees);
}

void ServoControl::setAngleImmediate(int degrees) {
  _target = clampSteer(degrees);
  _angle = _target;
  _servo.write(_angle);
}

void ServoControl::loop() {
  if (_angle == _target) return;
  const uint32_t now = millis();
  if (now - _lastMs < 10) return;
  uint32_t steps = (now - _lastMs) / 10;
  if (steps > 4) steps = 4;
  _lastMs = now;

  for (uint32_t i = 0; i < steps; i++) {
    if (_angle == _target) break;
    const int d = _target - _angle;
    const int step = (int)_servoSpeed;
    if (abs(d) <= step) _angle = _target;
    else _angle += (d > 0 ? step : -step);
  }
  _servo.write(_angle);
}

#include "servo_control.h"

void ServoControl::begin() {
  // ESP32-S3: attach with explicit pulse range for MG90S
  _servo.setPeriodHertz(50);
  _servo.attach(SERVO_PIN, 500, 2400);
  setAngle(SERVO_CENTER);
  Serial.printf("[servo] ready on pin D4, centered at %d°\n", SERVO_CENTER);
}

void ServoControl::setAngle(int degrees) {
  if (degrees < SERVO_MIN) degrees = SERVO_MIN;
  if (degrees > SERVO_MAX) degrees = SERVO_MAX;
  _angle = degrees;
  _servo.write(_angle);
}

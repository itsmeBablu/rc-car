#include "motor_control.h"
#include "config.h"

/*
 * DRV8833: PWM on the active IN, other IN held LOW.
 * Arduino-ESP32 2.x API: ledcSetup + ledcAttachPin + ledcWrite(channel).
 * Channels 4–7 leave 0–3 for camera/servo where possible.
 */

static const int CH_A_IN1 = 4;
static const int CH_A_IN2 = 5;
static const int CH_B_IN3 = 6;
static const int CH_B_IN4 = 7;

static int pinToChannel(int pin) {
  if (pin == MOTOR_A_IN1) return CH_A_IN1;
  if (pin == MOTOR_A_IN2) return CH_A_IN2;
  if (pin == MOTOR_B_IN3) return CH_B_IN3;
  if (pin == MOTOR_B_IN4) return CH_B_IN4;
  return -1;
}

void MotorControl::begin() {
  pinMode(MOTOR_ENABLE_PIN, OUTPUT);
  digitalWrite(MOTOR_ENABLE_PIN, HIGH);

  ledcSetup(CH_A_IN1, MOTOR_PWM_FREQ, MOTOR_PWM_RES);
  ledcSetup(CH_A_IN2, MOTOR_PWM_FREQ, MOTOR_PWM_RES);
  ledcSetup(CH_B_IN3, MOTOR_PWM_FREQ, MOTOR_PWM_RES);
  ledcSetup(CH_B_IN4, MOTOR_PWM_FREQ, MOTOR_PWM_RES);
  ledcAttachPin(MOTOR_A_IN1, CH_A_IN1);
  ledcAttachPin(MOTOR_A_IN2, CH_A_IN2);
  ledcAttachPin(MOTOR_B_IN3, CH_B_IN3);
  ledcAttachPin(MOTOR_B_IN4, CH_B_IN4);
  _pwmOk = true;

  stop();
  Serial.println("[motor] DRV8833 LEDC PWM ready (ch4-7)");
  Serial.println("[motor] ready (profile-scaled + ramped)");
}

void MotorControl::setProfile(uint8_t maxPwm, uint8_t accelRate,
                              uint8_t brakeStrength) {
  _maxPwm = maxPwm ? maxPwm : 1;
  _accel = accelRate ? accelRate : 1;
  _brake = brakeStrength ? brakeStrength : 1;
  _targetLeft = scaleCommand(_cmdLeft);
  _targetRight = scaleCommand(_cmdRight);
}

int MotorControl::scaleCommand(int speed) const {
  if (speed > 255) speed = 255;
  if (speed < -255) speed = -255;
  if (speed > -18 && speed < 18) return 0;
  const int mag = (abs(speed) * (int)_maxPwm) / 255;
  return speed >= 0 ? mag : -mag;
}

int MotorControl::stepToward(int current, int target) const {
  if (current == target) return current;
  const int delta = target - current;
  const bool braking =
      (target == 0) ||
      (current > 0 && target < current) ||
      (current < 0 && target > current);
  const int step = (int)(braking ? _brake : _accel);
  if (abs(delta) <= step) return target;
  return current + (delta > 0 ? step : -step);
}

void MotorControl::writeBridge(int inPos, int inNeg, int speed) {
  if (speed > 255) speed = 255;
  if (speed < -255) speed = -255;

  const int chPos = pinToChannel(inPos);
  const int chNeg = pinToChannel(inNeg);

  if (speed > -18 && speed < 18) {
    if (_pwmOk && chPos >= 0 && chNeg >= 0) {
      ledcWrite(chPos, 0);
      ledcWrite(chNeg, 0);
    } else {
      digitalWrite(inPos, LOW);
      digitalWrite(inNeg, LOW);
    }
    return;
  }

  const int mag = abs(speed);
  if (_pwmOk && chPos >= 0 && chNeg >= 0) {
    if (speed > 0) {
      ledcWrite(chPos, mag);
      ledcWrite(chNeg, 0);
    } else {
      ledcWrite(chPos, 0);
      ledcWrite(chNeg, mag);
    }
  } else {
    if (speed > 0) {
      digitalWrite(inPos, HIGH);
      digitalWrite(inNeg, LOW);
    } else {
      digitalWrite(inPos, LOW);
      digitalWrite(inNeg, HIGH);
    }
  }
}

void MotorControl::applyOutputs() {
  digitalWrite(MOTOR_ENABLE_PIN, HIGH);
  writeBridge(MOTOR_A_IN1, MOTOR_A_IN2, _left);
  writeBridge(MOTOR_B_IN3, MOTOR_B_IN4, _right);
}

void MotorControl::setLeft(int speed) {
  if (speed > 255) speed = 255;
  if (speed < -255) speed = -255;
  _cmdLeft = speed;
  _targetLeft = scaleCommand(speed);
}

void MotorControl::setRight(int speed) {
  if (speed > 255) speed = 255;
  if (speed < -255) speed = -255;
  _cmdRight = speed;
  _targetRight = scaleCommand(speed);
}

void MotorControl::setBoth(int left, int right) {
  if (left > 255) left = 255;
  if (left < -255) left = -255;
  if (right > 255) right = 255;
  if (right < -255) right = -255;
  _cmdLeft = left;
  _cmdRight = right;
  _targetLeft = scaleCommand(left);
  _targetRight = scaleCommand(right);
}

void MotorControl::stop() {
  _cmdLeft = 0;
  _cmdRight = 0;
  _targetLeft = 0;
  _targetRight = 0;
  _left = 0;
  _right = 0;
  applyOutputs();
}

void MotorControl::loop() {
  const uint32_t now = millis();
  if (now - _lastRampMs < 10) return;
  uint32_t steps = (now - _lastRampMs) / 10;
  if (steps > 4) steps = 4;
  _lastRampMs = now;

  for (uint32_t i = 0; i < steps; i++) {
    _left = stepToward(_left, _targetLeft);
    _right = stepToward(_right, _targetRight);
  }
  applyOutputs();
}

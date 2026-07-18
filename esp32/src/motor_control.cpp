#include "motor_control.h"
#include "config.h"

/*
 * DRV8833 truth (one bridge):
 *   IN+ HIGH, IN- LOW  → forward
 *   IN+ LOW,  IN- HIGH → reverse
 *   both LOW           → coast/stop
 *
 * We use digitalWrite (not LEDC) so the servo's PWM cannot steal motor pins.
 * Non-zero speed = full on (fine for bring-up / 1:24 car at 3.7V).
 */

void MotorControl::begin() {
  pinMode(MOTOR_ENABLE_PIN, OUTPUT);
  digitalWrite(MOTOR_ENABLE_PIN, HIGH); // EEP / nSLEEP must be HIGH

  pinMode(MOTOR_A_IN1, OUTPUT);
  pinMode(MOTOR_A_IN2, OUTPUT);
  pinMode(MOTOR_B_IN3, OUTPUT);
  pinMode(MOTOR_B_IN4, OUTPUT);

  stop();

  Serial.println("[motor] DRV8833 digital driver ready");
  Serial.println("[motor] Wire by LABEL (not by position):");
  Serial.println("[motor]   XIAO D0 -> DRV IN1");
  Serial.println("[motor]   XIAO D1 -> DRV IN2");
  Serial.println("[motor]   XIAO D2 -> DRV IN3");
  Serial.println("[motor]   XIAO D3 -> DRV IN4");
  Serial.println("[motor]   XIAO D5 -> DRV EEP");
  Serial.println("[motor]   rail+  -> DRV VCC");
  Serial.println("[motor]   rail-  -> DRV GND");
  Serial.println("[motor]   OUT1/OUT2 -> Motor A | OUT3/OUT4 -> Motor B");

  // Boot pulse: both motors forward briefly (confirm wiring)
  Serial.println("[motor] boot pulse both...");
  setBoth(255, 255);
  delay(250);
  stop();
  Serial.println("[motor] ready (both bridges)");
}

void MotorControl::writeBridge(int inPos, int inNeg, int speed) {
  if (speed > 255) speed = 255;
  if (speed < -255) speed = -255;

  // Deadband — ignore tiny slider noise
  if (speed > -25 && speed < 25) {
    digitalWrite(inPos, LOW);
    digitalWrite(inNeg, LOW);
    return;
  }

  if (speed > 0) {
    digitalWrite(inPos, HIGH);
    digitalWrite(inNeg, LOW);
  } else {
    digitalWrite(inPos, LOW);
    digitalWrite(inNeg, HIGH);
  }
}

void MotorControl::setLeft(int speed) {
  _left = speed;
  // Motor A = OUT1/OUT2 controlled by IN1/IN2
  writeBridge(MOTOR_A_IN1, MOTOR_A_IN2, speed);
}

void MotorControl::setRight(int speed) {
  _right = speed;
  // Motor B = OUT3/OUT4 controlled by IN3/IN4
  writeBridge(MOTOR_B_IN3, MOTOR_B_IN4, speed);
}

void MotorControl::setBoth(int left, int right) {
  digitalWrite(MOTOR_ENABLE_PIN, HIGH); // keep awake
  setLeft(left);
  setRight(right);
  Serial.printf("[motor] L=%d R=%d  (IN1=%d IN2=%d IN3=%d IN4=%d EEP=1)\n",
                _left, _right,
                digitalRead(MOTOR_A_IN1), digitalRead(MOTOR_A_IN2),
                digitalRead(MOTOR_B_IN3), digitalRead(MOTOR_B_IN4));
}

void MotorControl::stop() {
  setLeft(0);
  setRight(0);
}

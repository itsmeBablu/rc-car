#include <Arduino.h>

#include "ble_provision.h"
#include "config.h"
#include "motor_control.h"
#include "servo_control.h"
#include "websocket_control.h"
#include "wifi_control.h"

ServoControl servo;
MotorControl motors;
WifiControl wifi;
BleProvision ble;
WebsocketControl websocket;

void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println();
  Serial.println("=== RC-Car: BLE control + optional WiFi ===");

  // Motors BEFORE servo — keep GPIO ownership clear
  motors.begin();
  servo.begin();

  // BLE first — primary control link when no WiFi
  ble.begin(&wifi, &servo, &motors);

  wifi.begin([](const String &json) {
    ble.notifyStatus(json);
    if (json.indexOf("\"wifi\":\"connected\"") >= 0) {
      if (!websocket.isRunning()) {
        websocket.begin(&servo, &motors);
      }
      if (!ble.isClientConnected()) {
        ble.restartAdvertising();
      }
    }
  });

  // Only auto-join networks that previously connected successfully
  delay(500);
  wifi.trySaved();

  Serial.println("[ready] BLE name: RC Car | WiFi optional via app");
}

void loop() {
  ble.loop();
  wifi.loop();
  websocket.loop();
}

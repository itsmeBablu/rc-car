#include <Arduino.h>
#include <WiFi.h>

#include "ble_provision.h"
#include "camera_stream.h"
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
CameraStream camera;

void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println();
  Serial.println("=== RC-Car: BLE + WiFi + camera ===");

  // Camera FIRST — needs LEDC timer 0 + PSRAM before servo steals channels
  if (!camera.begin()) {
    Serial.println("[cam] unavailable — drive still works");
  }

  motors.begin();
  servo.begin();

  ble.begin(&wifi, &servo, &motors);

  wifi.begin([](const String &json) {
    ble.notifyStatus(json);
    if (json.indexOf("\"wifi\":\"connected\"") >= 0) {
      if (!websocket.isRunning()) {
        websocket.begin(&servo, &motors);
      }
      camera.startServer();
      if (!ble.isClientConnected()) {
        ble.restartAdvertising();
      }
    }
  });

  delay(500);
  wifi.trySaved();

  Serial.println("[ready] BLE: RC Car | open http://<ip>/jpg when WiFi up");
}

void loop() {
  ble.loop();
  wifi.loop();
  websocket.loop();
  // If WiFi came up without callback race, ensure HTTP cam is on
  if (WiFi.status() == WL_CONNECTED && !camera.isServerRunning()) {
    camera.startServer();
  }
  camera.loop();
}

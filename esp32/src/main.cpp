#include <Arduino.h>
#include <WiFi.h>

#include "battery_monitor.h"
#include "ble_provision.h"
#include "camera_stream.h"
#include "config.h"
#include "motor_control.h"
#include "ota_update.h"
#include "servo_control.h"
#include "websocket_control.h"
#include "wifi_control.h"

ServoControl servo;
MotorControl motors;
WifiControl wifi;
BleProvision ble;
WebsocketControl websocket;
CameraStream camera;
BatteryMonitor battery;
OtaUpdate ota;

void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println();
  Serial.println("=== RC-Car: BLE + WiFi + camera + OTA ===");

  // Camera FIRST — needs LEDC timer 0 + PSRAM before servo steals channels
  if (!camera.begin()) {
    Serial.println("[cam] unavailable — drive still works");
  }

  motors.begin();
  servo.begin();

  ble.begin(&wifi, &servo, &motors);

  battery.begin([](const String &json) { ble.notifyStatus(json); });

  wifi.begin([](const String &json) {
    ble.notifyStatus(json);
    if (json.indexOf("\"wifi\":\"connected\"") >= 0) {
      if (!websocket.isRunning()) {
        websocket.begin(&servo, &motors);
      }
      camera.startServer();
      ota.begin();
      if (!ble.isClientConnected()) {
        ble.restartAdvertising();
      }
    }
  });

  delay(500);
  wifi.trySaved();

  Serial.println("[ready] BLE: RC Car | OTA when WiFi up | http://<ip>/jpg");
}

void loop() {
  ble.loop();
  wifi.loop();
  battery.loop();
  ota.loop();
  websocket.loop();
  // If WiFi came up without callback race, ensure HTTP cam is on
  if (WiFi.status() == WL_CONNECTED && !camera.isServerRunning()) {
    camera.startServer();
  }
  camera.loop();
}

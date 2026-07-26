#include <Arduino.h>
#include <WiFi.h>

#include "battery_monitor.h"
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
WebsocketControl websocket;
CameraStream camera;
BatteryMonitor battery;
OtaUpdate ota;

static uint32_t gLastBattBroadcastMs = 0;
static uint32_t gCamStartMs = 0;
static bool gCamStarted = false;

void setup() {
  Serial.begin(115200);
  delay(600);
  Serial.println();
  Serial.println("=== RC-Car: SoftAP drive + optional home Wi‑Fi ===");
  Serial.println("[prio] 1) WS link  2) servo  3) motors  4) camera last");

  // Actuators ready before network
  servo.begin();
  motors.begin();

  wifi.begin(&battery, &camera);
  websocket.begin(&servo, &motors);

  battery.begin([](const String &json) { websocket.broadcast(json); });

  gCamStartMs = millis();

  Serial.printf("[ready] Join SoftAP \"%s\" / %s\n", AP_SSID, AP_PASS);
  Serial.printf("[ready] Control  ws://%s:%u\n", WiFi.softAPIP().toString().c_str(),
                WS_PORT);
  Serial.printf("[ready] Debug    http://%s/\n", WiFi.softAPIP().toString().c_str());
}

void loop() {
  // 1) Connection / control input — drain several WS events per tick
  for (int i = 0; i < 4; i++) websocket.loop();

  // 2) Servo, then 3) DC motors
  servo.loop();
  motors.loop();

  // Network / HTTP (camera routes served here — must not starve WS)
  wifi.loop();
  for (int i = 0; i < 2; i++) websocket.loop();

  battery.loop();
  ota.loop();

  // 4) Camera last — start after SoftAP/WS settle
  if (!gCamStarted && millis() - gCamStartMs > 2500) {
    gCamStarted = true;
    if (!camera.begin()) {
      Serial.println("[cam] unavailable — drive still works");
    }
  }
  camera.loop();

  if (wifi.homeConnected() && !ota.isReady()) {
    ota.begin();
  }

  if (millis() - gLastBattBroadcastMs > 8000) {
    gLastBattBroadcastMs = millis();
    websocket.broadcast(battery.statusJson());
  }
}

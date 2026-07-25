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
  Serial.println("[prio] 1) stay linked  2) motors/servo  3) camera");

  motors.begin();
  servo.begin();

  // SoftAP + HTTP status first — drive path before camera
  wifi.begin(&battery, &camera);
  websocket.begin(&servo, &motors);

  battery.begin([](const String &json) {
    // Push battery over WS when someone is linked
    websocket.broadcast(json);
  });

  gCamStartMs = millis();

  Serial.printf("[ready] Join SoftAP \"%s\" / %s\n", AP_SSID, AP_PASS);
  Serial.printf("[ready] Control  ws://%s:%u\n", WiFi.softAPIP().toString().c_str(),
                WS_PORT);
  Serial.printf("[ready] Debug    http://%s/\n", WiFi.softAPIP().toString().c_str());
}

void loop() {
  // Control path first — ramp motors/servo every tick
  websocket.loop();
  motors.loop();
  servo.loop();
  wifi.loop();
  battery.loop();
  ota.loop();

  // Camera last — init after ~2s so SoftAP/WS settle
  if (!gCamStarted && millis() - gCamStartMs > 2000) {
    gCamStarted = true;
    if (!camera.begin()) {
      Serial.println("[cam] unavailable — drive still works");
    }
  }
  camera.loop();

  if (wifi.homeConnected() && !ota.isReady()) {
    ota.begin();
  }

  // Soft heartbeat if no battery change
  if (millis() - gLastBattBroadcastMs > 5000) {
    gLastBattBroadcastMs = millis();
    websocket.broadcast(battery.statusJson());
  }
}

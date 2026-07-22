#include <Arduino.h>
#include <WiFi.h>

#include "battery_monitor.h"
#include "camera_stream.h"
#include "config.h"
#include "motor_control.h"
#include "ota_update.h"
#include "servo_control.h"
#include "setup_server.h"
#include "websocket_control.h"
#include "wifi_manager.h"

ServoControl servo;
MotorControl motors;
WifiManager wifi;
SetupServer http;
WebsocketControl websocket;
CameraStream camera;
BatteryMonitor battery;
OtaUpdate ota;

static bool servicesStarted = false;

static void startDriveServices() {
  if (!websocket.isRunning()) {
    websocket.begin(&servo, &motors);
  } else {
    websocket.rebind();
  }
  if (wifi.isStaConnected() && wifi.isHomeMode()) {
    ota.begin();
  }
  servicesStarted = true;
  Serial.printf("[ready] drive services (%s)\n",
                wifi.isHomeMode() ? "home" : "direct");
}

static void onNetworkReady() {
  if (http.isRunning()) http.rebind();
  if (wifi.isDriveReady() || wifi.isApActive()) {
    startDriveServices();
  }
}

void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println();
  Serial.println("=== RC-Car: Home / Direct / Setup (Wi‑Fi only) ===");

  wifi.begin(
      [](const String &json) {
        Serial.printf("[wifi-status] %s\n", json.c_str());
        if (json.indexOf("\"status\":\"connected\"") >= 0 &&
            (json.indexOf("\"mode\":\"direct\"") >= 0 ||
             json.indexOf("\"mode\":\"home\"") >= 0)) {
          startDriveServices();
        }
      },
      onNetworkReady);

  // SoftAP FIRST (before camera) so the radio is up and hotspot is visible
  wifi.bootSoftAp();
  delay(300);

  if (!camera.begin()) {
    Serial.println("[cam] unavailable — drive still works");
  }

  motors.begin();
  servo.begin();

  http.begin(&wifi, &camera, &battery);

  wifi.setNetworkNotifyEnabled(true);
  wifi.notifyNetworkNow();

  battery.begin([](const String &json) { websocket.broadcast(json); });

  delay(100);
  wifi.trySavedOrFallback();

  Serial.printf("[boot] hotspot \"%s\" / %s → http://192.168.4.1/\n", AP_SSID,
                AP_PASS);
}

void loop() {
  wifi.loop();
  http.loop();
  battery.loop();
  if (wifi.isStaConnected()) ota.loop();
  if (!servicesStarted && wifi.isApActive()) {
    startDriveServices();
  }
  websocket.loop();
  camera.loop();
}

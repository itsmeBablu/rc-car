#include <Arduino.h>
#include <WiFi.h>

#include "battery_monitor.h"
#include "camera_stream.h"
#include "config.h"
#include "drive_pump.h"
#include "driving_mode.h"
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
DrivingModeManager driveModes;

static bool servicesStarted = false;
static bool cameraStarted = false;

static void pumpDriveServices() {
  static bool busy = false;
  if (busy) {
    yield();
    return;
  }
  busy = true;
  websocket.loop();
  driveModes.loop();
  busy = false;
}

/** Start WS once — never rebind unless SoftAP was fully restarted. */
static void startDriveServices(bool forceRebind = false) {
  if (!websocket.isRunning()) {
    websocket.begin(&servo, &motors, &driveModes);
  } else if (forceRebind) {
    websocket.rebind();
  }
  if (wifi.isStaConnected() && wifi.isHomeMode()) {
    ota.begin();
  }
  servicesStarted = true;
}

static void onNetworkReady() {
  if (http.isRunning()) http.syncDnsPublic();
  startDriveServices(false);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("=== RC-Car: SoftAP-first, drive-first ===");

  setDrivePump(pumpDriveServices);

  wifi.begin(
      [](const String &json) {
        Serial.printf("[wifi-status] %s\n", json.c_str());
        startDriveServices(false);
      },
      onNetworkReady);

  // 1) SoftAP only — browser must reach http://192.168.4.1 before camera
  wifi.bootSoftAp();
  delay(200);

  motors.begin();
  servo.begin();
  driveModes.begin(&motors, &servo, &camera, &battery);

  // 2) HTTP + WS before camera (camera init blocks Wi‑Fi briefly)
  http.begin(&wifi, &camera, &battery);
  wifi.setNetworkNotifyEnabled(true);
  wifi.notifyNetworkNow();
  startDriveServices(false);

  battery.begin([](const String &json) { websocket.broadcast(json); });

  // 3) Camera last — optional; SoftAP/drive already live
  if (!camera.begin()) {
    Serial.println("[cam] unavailable — drive still works");
  } else {
    cameraStarted = true;
    camera.setQuality(VideoQuality::Low); // SoftAP-friendly default
  }

  wifi.trySavedOrFallback();

  Serial.printf("[boot] hotspot \"%s\" / %s → http://192.168.4.1/\n", AP_SSID,
                AP_PASS);
  Serial.println("[boot] Home Wi‑Fi only after SoftAP has 0 clients");
}

void loop() {
  // Priority 1: drive
  websocket.loop();
  driveModes.loop();

  // Priority 2: network
  battery.loop();
  wifi.loop();

  // Priority 3: HTTP (camera /jpg may take time — pump mid-frame)
  http.loop();

  // Recover immediately after any blocking HTTP
  websocket.loop();
  driveModes.loop();

  if (wifi.isStaConnected()) ota.loop();
  if (!servicesStarted && wifi.isApActive()) startDriveServices(false);
}

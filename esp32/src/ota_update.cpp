#include "ota_update.h"
#include "config.h"

#include <ArduinoOTA.h>
#include <WiFi.h>

void OtaUpdate::begin() {
  if (_ready) return;
  if (WiFi.status() != WL_CONNECTED) return;

  ArduinoOTA.setHostname(MDNS_HOSTNAME);
  ArduinoOTA.setPassword(OTA_PASSWORD);

  ArduinoOTA.onStart([]() {
    Serial.println("[ota] start");
  });
  ArduinoOTA.onEnd([]() {
    Serial.println("\n[ota] done — rebooting");
  });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    static int last = -1;
    const int pct = total ? int(progress * 100 / total) : 0;
    if (pct != last && pct % 10 == 0) {
      last = pct;
      Serial.printf("[ota] %d%%\n", pct);
    }
  });
  ArduinoOTA.onError([](ota_error_t err) {
    Serial.printf("[ota] error %u\n", err);
  });

  ArduinoOTA.begin();
  _ready = true;
  Serial.printf("[ota] ready — pio upload via WiFi to %s (or %s.local)\n",
                WiFi.localIP().toString().c_str(), MDNS_HOSTNAME);
  Serial.printf("[ota] password: %s\n", OTA_PASSWORD);
}

void OtaUpdate::loop() {
  if (!_ready) {
    if (WiFi.status() == WL_CONNECTED) begin();
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    _ready = false;
    return;
  }
  ArduinoOTA.handle();
}

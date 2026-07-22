#pragma once

#include <Arduino.h>

/** ArduinoOTA — call begin() once WiFi has an IP; loop() every tick. */
class OtaUpdate {
public:
  void begin();
  void loop();
  bool isReady() const { return _ready; }

private:
  bool _ready = false;
};

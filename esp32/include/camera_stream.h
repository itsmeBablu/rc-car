#pragma once

#include <Arduino.h>

class CameraStream {
public:
  bool begin();
  void loop();
  bool isReady() const { return _ready; }
  void markHttpAttached() { _httpAttached = true; }
  bool isHttpAttached() const { return _httpAttached; }

private:
  bool _ready = false;
  bool _httpAttached = false;
};

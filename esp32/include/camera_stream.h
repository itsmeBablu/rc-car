#pragma once

#include <Arduino.h>

class CameraStream {
public:
  bool begin();
  void startServer();
  void loop();
  bool isReady() const { return _ready; }
  bool isServerRunning() const { return _serverRunning; }

private:
  bool _ready = false;
  bool _serverRunning = false;
};

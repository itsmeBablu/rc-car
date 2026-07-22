#pragma once

#include <Arduino.h>
#include <WebServer.h>

class CameraStream {
public:
  bool begin();
  /** Register /jpg /stream on the shared HTTP server (call once). */
  void attachRoutes(WebServer &server);
  void loop();
  bool isReady() const { return _ready; }
  bool routesAttached() const { return _routesAttached; }

private:
  bool _ready = false;
  bool _routesAttached = false;
};

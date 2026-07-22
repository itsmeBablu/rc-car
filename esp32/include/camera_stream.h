#pragma once

#include <Arduino.h>
#include <WebServer.h>

enum class VideoQuality : uint8_t {
  Auto = 0,
  Low = 1,
  Medium = 2,
  High = 3,
};

class CameraStream {
public:
  bool begin();
  /** Register /jpg /stream on the shared HTTP server (call once). */
  void attachRoutes(WebServer &server);
  void loop();
  bool isReady() const { return _ready; }
  bool routesAttached() const { return _routesAttached; }

  void setQuality(VideoQuality q);
  VideoQuality quality() const { return _quality; }
  VideoQuality effectiveQuality() const { return _effective; }
  /** Min ms between frames for current effective quality. */
  uint32_t frameIntervalMs() const;
  String statusJson() const;

  /** True while encoding/sending a frame — drive pump should still run. */
  bool isBusy() const { return _busy; }

  /** Mode-driven FPS floor (0 = use quality defaults). */
  void setIntervalOverride(uint16_t ms);
  uint16_t intervalOverride() const { return _intervalOverride; }

  /** Parse "auto"|"low"|"medium"|"high". Returns false if unknown. */
  static bool parseQuality(const String &s, VideoQuality &out);
  static const char *qualityName(VideoQuality q);

private:
  bool _ready = false;
  bool _routesAttached = false;
  bool _busy = false;
  VideoQuality _quality = VideoQuality::Auto;
  VideoQuality _effective = VideoQuality::Medium;
  uint32_t _lastServeMs = 0;
  uint32_t _slowStreak = 0;
  uint32_t _fastStreak = 0;
  uint16_t _intervalOverride = 0;

  void applySensor(VideoQuality q);
  void adaptAuto(uint32_t captureMs);
  friend void handleJpg();
  friend void handleStream();
};

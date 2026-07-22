#include "camera_stream.h"
#include "config.h"
#include "drive_pump.h"

#include <ArduinoJson.h>
#include <WiFi.h>
#include <esp_camera.h>

// XIAO ESP32-S3 Sense (OV2640 / OV3660 / OV5640)
#define PWDN_GPIO_NUM -1
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 10
#define SIOD_GPIO_NUM 40
#define SIOC_GPIO_NUM 39
#define Y9_GPIO_NUM 48
#define Y8_GPIO_NUM 11
#define Y7_GPIO_NUM 12
#define Y6_GPIO_NUM 14
#define Y5_GPIO_NUM 16
#define Y4_GPIO_NUM 18
#define Y3_GPIO_NUM 17
#define Y2_GPIO_NUM 15
#define VSYNC_GPIO_NUM 38
#define HREF_GPIO_NUM 47
#define PCLK_GPIO_NUM 13

static WebServer *gHttp = nullptr;
static CameraStream *gCam = nullptr;

static void sendCors() {
  if (!gHttp) return;
  gHttp->sendHeader("Access-Control-Allow-Origin", "*");
  gHttp->sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  gHttp->sendHeader("Access-Control-Allow-Headers", "*");
}

const char *CameraStream::qualityName(VideoQuality q) {
  switch (q) {
  case VideoQuality::Auto:
    return "auto";
  case VideoQuality::Low:
    return "low";
  case VideoQuality::Medium:
    return "medium";
  case VideoQuality::High:
    return "high";
  }
  return "auto";
}

bool CameraStream::parseQuality(const String &s, VideoQuality &out) {
  String t = s;
  t.trim();
  t.toLowerCase();
  if (t == "auto") {
    out = VideoQuality::Auto;
    return true;
  }
  if (t == "low") {
    out = VideoQuality::Low;
    return true;
  }
  if (t == "medium" || t == "med") {
    out = VideoQuality::Medium;
    return true;
  }
  if (t == "high") {
    out = VideoQuality::High;
    return true;
  }
  return false;
}

uint32_t CameraStream::frameIntervalMs() const {
  if (_intervalOverride > 0) return _intervalOverride;
  switch (_effective) {
  case VideoQuality::High:
    return CAM_INTERVAL_HIGH_MS;
  case VideoQuality::Low:
    return CAM_INTERVAL_LOW_MS;
  case VideoQuality::Medium:
  case VideoQuality::Auto:
  default:
    return CAM_INTERVAL_MED_MS;
  }
}

void CameraStream::setIntervalOverride(uint16_t ms) {
  _intervalOverride = ms;
  Serial.printf("[cam] interval override %u ms\n", (unsigned)ms);
}

void CameraStream::applySensor(VideoQuality q) {
  sensor_t *s = esp_camera_sensor_get();
  if (!s) return;

  framesize_t size = FRAMESIZE_QVGA;
  int quality = 18;
  switch (q) {
  case VideoQuality::Low:
    size = FRAMESIZE_QQVGA;
    quality = 28;
    break;
  case VideoQuality::Medium:
  case VideoQuality::Auto:
    size = FRAMESIZE_QVGA;
    quality = 18;
    break;
  case VideoQuality::High:
    size = psramFound() ? FRAMESIZE_CIF : FRAMESIZE_QVGA;
    quality = 12;
    break;
  }

  s->set_framesize(s, size);
  s->set_quality(s, quality);
  _effective = q == VideoQuality::Auto ? VideoQuality::Medium : q;
  Serial.printf("[cam] quality=%s effective=%s size=%d jpeg_q=%d interval=%ums\n",
                qualityName(_quality), qualityName(_effective), (int)size, quality,
                (unsigned)frameIntervalMs());
}

void CameraStream::setQuality(VideoQuality q) {
  _quality = q;
  _slowStreak = 0;
  _fastStreak = 0;
  if (!_ready) return;
  if (q == VideoQuality::Auto) {
    applySensor(VideoQuality::Medium);
    _quality = VideoQuality::Auto;
  } else {
    applySensor(q);
  }
}

void CameraStream::adaptAuto(uint32_t captureMs) {
  if (_quality != VideoQuality::Auto) return;

  if (captureMs > 90) {
    _slowStreak++;
    _fastStreak = 0;
    if (_slowStreak >= 3 && _effective != VideoQuality::Low) {
      applySensor(VideoQuality::Low);
      _quality = VideoQuality::Auto;
      _slowStreak = 0;
      Serial.println("[cam] auto -> low (CPU/load)");
    }
  } else if (captureMs < 45) {
    _fastStreak++;
    _slowStreak = 0;
    if (_fastStreak >= 12 && _effective == VideoQuality::Low) {
      applySensor(VideoQuality::Medium);
      _quality = VideoQuality::Auto;
      _fastStreak = 0;
      Serial.println("[cam] auto -> medium (headroom)");
    } else if (_fastStreak >= 20 && _effective == VideoQuality::Medium &&
               psramFound()) {
      applySensor(VideoQuality::High);
      _quality = VideoQuality::Auto;
      _fastStreak = 0;
      Serial.println("[cam] auto -> high (headroom)");
    }
  } else {
    _slowStreak = 0;
    _fastStreak = 0;
  }
}

String CameraStream::statusJson() const {
  JsonDocument doc;
  doc["ok"] = _ready;
  doc["quality"] = qualityName(_quality);
  doc["effective"] = qualityName(_effective);
  doc["intervalMs"] = frameIntervalMs();
  doc["intervalOverride"] = _intervalOverride;
  String out;
  serializeJson(doc, out);
  return out;
}

void handleJpg() {
  if (!gHttp || !gCam || !gCam->isReady()) {
    if (gHttp) {
      sendCors();
      gHttp->send(503, "text/plain", "cam_unavailable");
    }
    return;
  }

  const uint32_t minGap = gCam->frameIntervalMs();
  const uint32_t now = millis();
  if (now - gCam->_lastServeMs < minGap) {
    sendCors();
    gHttp->sendHeader("Retry-After", "0");
    gHttp->send(204);
    return;
  }

  pumpDrive();
  gCam->_busy = true;
  const uint32_t t0 = millis();
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    gCam->_busy = false;
    sendCors();
    gHttp->send(503, "text/plain", "capture_fail");
    return;
  }

  pumpDrive();
  sendCors();
  gHttp->sendHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  gHttp->sendHeader("X-RC-Video-Quality",
                    CameraStream::qualityName(gCam->effectiveQuality()));
  gHttp->setContentLength(fb->len);
  gHttp->send(200, "image/jpeg", "");
  WiFiClient client = gHttp->client();

  const size_t chunk = 1024;
  size_t off = 0;
  while (off < fb->len && client.connected()) {
    size_t n = fb->len - off;
    if (n > chunk) n = chunk;
    size_t w = client.write(fb->buf + off, n);
    if (w == 0) break;
    off += w;
    pumpDrive();
  }

  esp_camera_fb_return(fb);
  gCam->_lastServeMs = millis();
  const uint32_t dt = gCam->_lastServeMs - t0;
  gCam->adaptAuto(dt);
  gCam->_busy = false;
}

void handleStream() {
  if (!gHttp || !gCam || !gCam->isReady()) return;

  WiFiClient client = gHttp->client();
  client.println("HTTP/1.1 200 OK");
  client.println("Access-Control-Allow-Origin: *");
  client.println("Content-Type: multipart/x-mixed-replace; boundary=frame");
  client.println("Cache-Control: no-cache, no-store");
  client.println("Pragma: no-cache");
  client.println("Connection: close");
  client.println();

  uint32_t lastMs = 0;
  while (client.connected()) {
    pumpDrive();

    const uint32_t minGap = gCam->frameIntervalMs();
    uint32_t now = millis();
    if (now - lastMs < minGap) {
      delay(1);
      pumpDrive();
      continue;
    }

    gCam->_busy = true;
    const uint32_t t0 = millis();
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      gCam->_busy = false;
      delay(5);
      pumpDrive();
      continue;
    }

    client.printf(
        "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
        fb->len);

    size_t wrote = 0;
    const size_t chunk = 1024;
    while (wrote < fb->len && client.connected()) {
      size_t n = fb->len - wrote;
      if (n > chunk) n = chunk;
      size_t w = client.write(fb->buf + wrote, n);
      if (w == 0) break;
      wrote += w;
      pumpDrive();
    }
    client.print("\r\n");
    esp_camera_fb_return(fb);

    lastMs = millis();
    gCam->_lastServeMs = lastMs;
    gCam->adaptAuto(lastMs - t0);
    gCam->_busy = false;

    if (wrote == 0) break;
  }
}

bool CameraStream::begin() {
  if (_ready) return true;
  gCam = this;

  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.frame_size = FRAMESIZE_QVGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_LATEST;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 18;
  config.fb_count = 2;

  Serial.printf("[cam] PSRAM %s\n", psramFound() ? "yes" : "NO");
  if (!psramFound()) {
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.frame_size = FRAMESIZE_QQVGA;
    config.fb_count = 1;
    config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[cam] init failed 0x%x — retry 10MHz xclk\n", (unsigned)err);
    esp_camera_deinit();
    config.xclk_freq_hz = 10000000;
    err = esp_camera_init(&config);
  }
  if (err != ESP_OK) {
    Serial.printf("[cam] init failed 0x%x\n", (unsigned)err);
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    Serial.printf("[cam] sensor PID=0x%x\n", s->id.PID);
    if (s->id.PID == OV3660_PID) {
      s->set_vflip(s, 1);
      s->set_brightness(s, 1);
      s->set_saturation(s, -2);
    } else if (s->id.PID == OV2640_PID) {
      s->set_vflip(s, 1);
    }
  }

  for (int i = 0; i < 2; i++) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) esp_camera_fb_return(fb);
    delay(30);
  }

  _ready = true;
  setQuality(VideoQuality::Auto);
  Serial.println("[cam] ready — drive-priority, frames drop under load");
  return true;
}

void CameraStream::attachRoutes(WebServer &server) {
  if (_routesAttached) return;
  if (!_ready) begin();
  gHttp = &server;
  gCam = this;
  server.on("/jpg", HTTP_GET, handleJpg);
  server.on("/stream", HTTP_GET, handleStream);
  _routesAttached = true;
  Serial.println("[cam] routes /jpg /stream attached");
}

void CameraStream::loop() {}

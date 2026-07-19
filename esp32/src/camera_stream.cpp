#include "camera_stream.h"
#include "config.h"

#include <WebServer.h>
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

static WebServer camServer(CAMERA_HTTP_PORT);

static void sendCors() {
  camServer.sendHeader("Access-Control-Allow-Origin", "*");
  camServer.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  camServer.sendHeader("Access-Control-Allow-Headers", "*");
}

static void handleOptions() {
  sendCors();
  camServer.send(204);
}

static void handleRoot() {
  sendCors();
  camServer.send(200, "text/plain", "RC-Car cam OK — /jpg or /stream");
}

/** Single JPEG — reliable for phone browsers (polled by UI). */
static void handleJpg() {
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    sendCors();
    camServer.send(503, "text/plain", "capture_fail");
    return;
  }
  sendCors();
  camServer.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  camServer.setContentLength(fb->len);
  camServer.send(200, "image/jpeg", "");
  WiFiClient client = camServer.client();
  client.write(fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

/** MJPEG multipart (desktop Chrome usually OK). */
static void handleStream() {
  WiFiClient client = camServer.client();
  client.println("HTTP/1.1 200 OK");
  client.println("Access-Control-Allow-Origin: *");
  client.println("Content-Type: multipart/x-mixed-replace; boundary=frame");
  client.println("Cache-Control: no-cache, no-store");
  client.println("Pragma: no-cache");
  client.println("Connection: close");
  client.println();

  uint32_t lastMs = 0;
  while (client.connected()) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      delay(20);
      yield();
      continue;
    }

    client.printf(
        "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
        fb->len);
    size_t wrote = client.write(fb->buf, fb->len);
    client.print("\r\n");
    esp_camera_fb_return(fb);

    if (wrote == 0) break;

    // ~8–10 fps max so BLE/WiFi stay responsive
    uint32_t now = millis();
    if (now - lastMs < 100) delay(100 - (now - lastMs));
    lastMs = millis();
    yield();
  }
}

bool CameraStream::begin() {
  if (_ready) return true;

  // IMPORTANT: zero-init — garbage fields crash / fail init on S3
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
  config.jpeg_quality = 15;
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
    s->set_framesize(s, config.frame_size);
  }

  // Warm-up frames
  for (int i = 0; i < 3; i++) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) esp_camera_fb_return(fb);
    delay(50);
  }

  _ready = true;
  Serial.println("[cam] ready");
  return true;
}

void CameraStream::startServer() {
  if (!_ready) {
    if (!begin()) return;
  }
  if (_serverRunning) return;
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[cam] server wait — no WiFi yet");
    return;
  }

  camServer.on("/", HTTP_GET, handleRoot);
  camServer.on("/jpg", HTTP_GET, handleJpg);
  camServer.on("/stream", HTTP_GET, handleStream);
  camServer.on("/", HTTP_OPTIONS, handleOptions);
  camServer.on("/jpg", HTTP_OPTIONS, handleOptions);
  camServer.on("/stream", HTTP_OPTIONS, handleOptions);
  camServer.begin();
  _serverRunning = true;
  Serial.printf("[cam] http://%s/jpg  and  /stream\n",
                WiFi.localIP().toString().c_str());
}

void CameraStream::loop() {
  if (_serverRunning) camServer.handleClient();
}

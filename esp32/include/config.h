#pragma once

#include <Arduino.h>

// SoftAP — always the same SSID (setup + direct). Password 8+ chars.
static const char *AP_SSID = "Porsche_RC_Car";
static const char *AP_PASS = "12345678";

// Aliases (older code / UI)
static const char *SETUP_AP_SSID = AP_SSID;
static const char *SETUP_AP_PASS = AP_PASS;
static const char *DIRECT_AP_SSID = AP_SSID;
static const char *DIRECT_AP_PASS = AP_PASS;

static const IPAddress SETUP_AP_IP(192, 168, 4, 1);
static const IPAddress SETUP_AP_GW(192, 168, 4, 1);
static const IPAddress SETUP_AP_MASK(255, 255, 255, 0);

// SoftAP channel (6 usually quieter than 1). Keep fixed for DHCP stability.
static const uint8_t AP_CHANNEL = 6;
static const uint8_t AP_MAX_CLIENTS = 4;

// Let hotspot settle before any home-Wi‑Fi scan (AP+STA kills phone joins).
static const uint32_t SOFTAP_SETTLE_MS = 8000;
// While phones/PCs are on SoftAP, keep deferring STA so join finishes.
static const uint32_t SOFTAP_CLIENT_DEFER_MS = 4000;

// Boot: try saved STA this long, then Direct Mode
static const uint32_t STA_BOOT_TIMEOUT_MS = 12000;
// After STA joins from setup portal, keep SoftAP so phone can finish UI
static const uint32_t AP_HOLD_AFTER_CONNECT_MS = 60000;
static const uint8_t STA_CONNECT_MAX_ATTEMPTS = 3;
static const uint32_t STA_ATTEMPT_TIMEOUT_MS = 12000;

static const uint16_t WS_PORT = 81;
static const uint16_t HTTP_PORT = 80;
static const char *MDNS_HOSTNAME = "rc-car";

// Stop motors if no WS control message (drive/steer/stop) this long
static const uint32_t WS_CMD_WATCHDOG_MS = 800;

// Camera defaults — drive always wins; video is best-effort
static const uint32_t CAM_INTERVAL_HIGH_MS = 120;
static const uint32_t CAM_INTERVAL_MED_MS = 180;
static const uint32_t CAM_INTERVAL_LOW_MS = 280;

// OTA only in Home Mode (STA / router)
static const char *OTA_PASSWORD = "rc-car-ota";
static const uint16_t OTA_PORT = 3232;

static const int SERVO_PIN = D4;
static const int SERVO_MIN = 0;
static const int SERVO_MAX = 180;
static const int SERVO_CENTER = 90;

static const int MOTOR_A_IN1 = D0;
static const int MOTOR_A_IN2 = D1;
static const int MOTOR_B_IN3 = D2;
static const int MOTOR_B_IN4 = D3;
static const int MOTOR_ENABLE_PIN = D5;

static const int MOTOR_PWM_FREQ = 1000;
static const int MOTOR_PWM_RES = 8;

static const int BAT_ADC_PIN = D8;
static const int BAT_CHRG_PIN = D9;
static const int BAT_STDBY_PIN = D10;
static const float BAT_DIV_RATIO = 2.0f;
static const float BAT_ADC_SCALE = 1.0f;

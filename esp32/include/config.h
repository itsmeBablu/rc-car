#pragma once

#include <Arduino.h>

// BLE device name shown in browser / phone picker
static const char *BLE_DEVICE_NAME = "RC Car";

// Custom GATT service / characteristics (must match React lib/ble.ts)
static const char *BLE_SERVICE_UUID = "c0de0001-0c10-4a1a-9c1e-00a1b2c3d4e5";
static const char *BLE_SSID_UUID = "c0de0002-0c10-4a1a-9c1e-00a1b2c3d4e5";
static const char *BLE_PASS_UUID = "c0de0003-0c10-4a1a-9c1e-00a1b2c3d4e5";
static const char *BLE_CMD_UUID = "c0de0004-0c10-4a1a-9c1e-00a1b2c3d4e5";
static const char *BLE_STATUS_UUID = "c0de0005-0c10-4a1a-9c1e-00a1b2c3d4e5";
static const char *BLE_CONTROL_UUID = "c0de0006-0c10-4a1a-9c1e-00a1b2c3d4e5";

static const uint16_t WS_PORT = 81;
static const uint16_t CAMERA_HTTP_PORT = 80;
static const char *MDNS_HOSTNAME = "rc-car";

// WiFi OTA (ArduinoOTA / PlatformIO espota) — change after first flash if you want
static const char *OTA_PASSWORD = "rc-car-ota";
static const uint16_t OTA_PORT = 3232;

// MG90S signal
static const int SERVO_PIN = D4;
static const int SERVO_MIN = 0;
static const int SERVO_MAX = 180;
static const int SERVO_CENTER = 90;

// DRV8833 logic inputs (XIAO → driver)
// D0→IN1, D1→IN2 (Motor A / left), D2→IN3, D3→IN4 (Motor B / right)
static const int MOTOR_A_IN1 = D0;
static const int MOTOR_A_IN2 = D1;
static const int MOTOR_B_IN3 = D2;
static const int MOTOR_B_IN4 = D3;
// EEP / nSLEEP — MUST be HIGH or motors stay off (many modules float this pin)
// Keep D5 here — do NOT reuse D5 for battery sense.
static const int MOTOR_ENABLE_PIN = D5;

static const int MOTOR_PWM_FREQ = 1000; // Hz — reliable for DRV8833 + N20
static const int MOTOR_PWM_RES = 8;     // 0–255

// 1S LiPo via TP4056
// Divider must keep ADC < 3.3V at 4.2V pack. Prefer 1:1:
//   OUT+ — R — D8 — R — GND   with two equal resistors
//   OK: 10k+10k, 220k+220k, or 100k+100k  → Vbat = 2 × Vadc (BAT_DIV_RATIO 2.0)
//   Avoid: 10k top + 220k bottom (ADC can see ~4V — too high)
// D8 alone = voltage/% only — cannot detect USB plug.
// CHRG  (active-low while charging)     → D9
// STDBY (active-low when charge done)   → D10  (needed for green UI at ~100%)
static const int BAT_ADC_PIN = D8;
static const int BAT_CHRG_PIN = D9;
static const int BAT_STDBY_PIN = D10;
// Vbat = Vadc * BAT_DIV_RATIO. 1:1 divider → 2.0
static const float BAT_DIV_RATIO = 2.0f;
// Fine-tune if % is off. Try 0.95–1.05.
static const float BAT_ADC_SCALE = 1.0f;

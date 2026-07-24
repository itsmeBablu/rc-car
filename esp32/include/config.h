#pragma once

#include <Arduino.h>

// SoftAP — always on for drive when off the home network
static const char *AP_SSID = "Porsche_RC_Car";
static const char *AP_PASS = "12345678";
static const IPAddress AP_IP(192, 168, 4, 1);

static const uint16_t WS_PORT = 81;
static const uint16_t HTTP_PORT = 80;
static const char *MDNS_HOSTNAME = "rc-car";

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

#include "driving_mode.h"
#include "battery_monitor.h"
#include "camera_stream.h"
#include "motor_control.h"
#include "servo_control.h"

#include <ArduinoJson.h>

static const DrivingProfile PROFILE_NORMAL = {
    .maxMotorPwm = 178,       // 70%
    .accelerationRate = 6,    // smooth
    .brakeStrength = 14,      // medium
    .servoSpeed = 4,          // smooth
    .maxSteeringPct = 80,
    .cameraIntervalMs = 67,   // ~15 FPS
    .batteryMode = BatterySaveMode::Balanced,
};

static const DrivingProfile PROFILE_SPORT = {
    .maxMotorPwm = 255,       // 100%
    .accelerationRate = 42,   // very quick
    .brakeStrength = 55,      // strong
    .servoSpeed = 18,         // fast
    .maxSteeringPct = 100,
    .cameraIntervalMs = 180,  // drop FPS for controls
    .batteryMode = BatterySaveMode::Performance,
};

static const DrivingProfile PROFILE_CRAWL = {
    .maxMotorPwm = 102,       // 40%
    .accelerationRate = 2,    // very smooth
    .brakeStrength = 5,       // gentle
    .servoSpeed = 1,          // precise
    .maxSteeringPct = 100,
    .cameraIntervalMs = 220,
    .batteryMode = BatterySaveMode::Eco,
};

const DrivingProfile &profileFor(DriveMode mode) {
  switch (mode) {
  case DriveMode::Sport:
    return PROFILE_SPORT;
  case DriveMode::Crawl:
    return PROFILE_CRAWL;
  case DriveMode::Normal:
  default:
    return PROFILE_NORMAL;
  }
}

const char *driveModeName(DriveMode mode) {
  switch (mode) {
  case DriveMode::Sport:
    return "SPORT";
  case DriveMode::Crawl:
    return "CRAWL";
  case DriveMode::Normal:
  default:
    return "NORMAL";
  }
}

bool parseDriveMode(const String &s, DriveMode &out) {
  String t = s;
  t.trim();
  t.toUpperCase();
  if (t == "NORMAL" || t == "N") {
    out = DriveMode::Normal;
    return true;
  }
  if (t == "SPORT" || t == "S") {
    out = DriveMode::Sport;
    return true;
  }
  if (t == "CRAWL" || t == "C") {
    out = DriveMode::Crawl;
    return true;
  }
  return false;
}

void DrivingModeManager::begin(MotorControl *motors, ServoControl *servo,
                               CameraStream *camera, BatteryMonitor *battery) {
  _motors = motors;
  _servo = servo;
  _camera = camera;
  _battery = battery;
  setMode(DriveMode::Normal);
}

bool DrivingModeManager::setMode(DriveMode mode) {
  _mode = mode;
  _profile = &profileFor(mode);
  applyToHardware();
  Serial.printf("[drive] mode=%s maxPWM=%u accel=%u brake=%u steer=%u%% servo=%u cam=%ums\n",
                driveModeName(_mode), (unsigned)_profile->maxMotorPwm,
                (unsigned)_profile->accelerationRate,
                (unsigned)_profile->brakeStrength,
                (unsigned)_profile->maxSteeringPct,
                (unsigned)_profile->servoSpeed,
                (unsigned)_profile->cameraIntervalMs);
  return true;
}

bool DrivingModeManager::setMode(const String &name) {
  DriveMode m;
  if (!parseDriveMode(name, m)) return false;
  return setMode(m);
}

void DrivingModeManager::applyToHardware() {
  if (!_profile) return;
  if (_motors) {
    _motors->setProfile(_profile->maxMotorPwm, _profile->accelerationRate,
                        _profile->brakeStrength);
  }
  if (_servo) {
    _servo->setProfile(_profile->maxSteeringPct, _profile->servoSpeed);
  }
  if (_camera) {
    _camera->setIntervalOverride(_profile->cameraIntervalMs);
  }
  if (_battery) {
    uint32_t sampleMs = 200;
    uint32_t emitMs = 400;
    switch (_profile->batteryMode) {
    case BatterySaveMode::Performance:
      sampleMs = 150;
      emitMs = 300;
      break;
    case BatterySaveMode::Eco:
      sampleMs = 500;
      emitMs = 1500;
      break;
    case BatterySaveMode::Balanced:
    default:
      break;
    }
    _battery->setIntervals(sampleMs, emitMs);
  }
}

void DrivingModeManager::loop() {
  if (_motors) _motors->loop();
  if (_servo) _servo->loop();
}

String DrivingModeManager::statusJson() const {
  JsonDocument doc;
  doc["mode"] = driveModeName(_mode);
  if (_profile) {
    doc["maxMotorPwm"] = _profile->maxMotorPwm;
    doc["accel"] = _profile->accelerationRate;
    doc["brake"] = _profile->brakeStrength;
    doc["servoSpeed"] = _profile->servoSpeed;
    doc["maxSteerPct"] = _profile->maxSteeringPct;
    doc["cameraMs"] = _profile->cameraIntervalMs;
  }
  String out;
  serializeJson(doc, out);
  return out;
}

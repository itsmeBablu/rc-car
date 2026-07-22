#pragma once

#include <Arduino.h>

enum class DriveMode : uint8_t {
  Normal = 0,
  Sport = 1,
  Crawl = 2,
};

enum class BatterySaveMode : uint8_t {
  Balanced = 0,
  Performance = 1,
  Eco = 2,
};

/** Tunable profile loaded by each driving mode. */
struct DrivingProfile {
  uint8_t maxMotorPwm;       // 0–255 absolute cap
  uint8_t accelerationRate;  // PWM units stepped up per 10 ms
  uint8_t brakeStrength;     // PWM units stepped down per 10 ms
  uint8_t servoSpeed;        // degrees toward target per 10 ms
  uint8_t maxSteeringPct;    // % of lock (center ± 90°)
  uint16_t cameraIntervalMs; // min ms between frames
  BatterySaveMode batteryMode;
};

const DrivingProfile &profileFor(DriveMode mode);
const char *driveModeName(DriveMode mode);
bool parseDriveMode(const String &s, DriveMode &out);

class MotorControl;
class ServoControl;
class CameraStream;
class BatteryMonitor;

class DrivingModeManager {
public:
  void begin(MotorControl *motors, ServoControl *servo, CameraStream *camera,
             BatteryMonitor *battery);
  /** Apply profile immediately (no reboot). */
  bool setMode(DriveMode mode);
  bool setMode(const String &name);
  DriveMode mode() const { return _mode; }
  const DrivingProfile &profile() const { return *_profile; }
  /** Ramp motors / servo — call from main loop (priority 1). */
  void loop();
  String statusJson() const;

private:
  DriveMode _mode = DriveMode::Normal;
  const DrivingProfile *_profile = nullptr;
  MotorControl *_motors = nullptr;
  ServoControl *_servo = nullptr;
  CameraStream *_camera = nullptr;
  BatteryMonitor *_battery = nullptr;

  void applyToHardware();
};

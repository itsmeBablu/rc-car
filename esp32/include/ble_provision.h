#pragma once

#include <Arduino.h>
#include "motor_control.h"
#include "servo_control.h"
#include "wifi_control.h"

class BleProvision {
public:
  void begin(WifiControl *wifi, ServoControl *servo, MotorControl *motors);
  void loop();
  void notifyStatus(const String &json);
  void restartAdvertising();
  bool isClientConnected() const { return _clientConnected; }
  bool isAdvertising() const { return _advertising; }

  void onWriteSsid(const String &value);
  void onWritePass(const String &value);
  void onWriteCmd(const String &value);
  void onWriteControl(const String &value);
  void onBleConnect();
  void onBleDisconnect();

private:
  WifiControl *_wifi = nullptr;
  ServoControl *_servo = nullptr;
  MotorControl *_motors = nullptr;
  String _ssid;
  String _pass;
  bool _pendingConnect = false;
  bool _clientConnected = false;
  bool _advertising = false;
  uint32_t _lastHeartbeatMs = 0;
};

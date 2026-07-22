#pragma once

#include <Arduino.h>
#include <functional>

/**
 * 1S LiPo sense via divider on BAT_ADC_PIN.
 * TP4056 CHRG (D9) + STDBY (D10), both active-low open-drain.
 * JSON: batt, mv, usb (plugged), charging (CHRG), full (STDBY).
 */
class BatteryMonitor {
public:
  using StatusFn = std::function<void(const String &)>;

  void begin(StatusFn onStatus = nullptr);
  void loop();

  int percent() const { return _percent; }
  bool usb() const { return _usb; }
  bool charging() const { return _charging; }
  bool full() const { return _full; }
  int millivolts() const { return _mv; }
  String statusJson() const;

private:
  void sample();
  void emitIfChanged(bool force);

  StatusFn _onStatus;
  int _percent = 100;
  int _mv = 4200;
  bool _usb = false;
  bool _charging = false;
  bool _full = false;
  int _lastEmittedPct = -1;
  bool _lastEmittedUsb = false;
  bool _lastEmittedChg = false;
  bool _lastEmittedFull = false;
  uint32_t _lastSampleMs = 0;
  uint32_t _lastEmitMs = 0;
  float _filtMv = 0;
  bool _filtReady = false;
};

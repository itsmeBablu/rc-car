#include "battery_monitor.h"
#include "config.h"

#include <ArduinoJson.h>

// LiPo open-circuit approximate SoC curve (mV → %)
static int mvToPercent(int mv) {
  static const int table[][2] = {
      {4200, 100}, {4100, 90}, {4000, 80}, {3900, 70}, {3800, 60},
      {3750, 50},  {3700, 40}, {3650, 30}, {3600, 20}, {3500, 10},
      {3400, 5},   {3300, 0},
  };
  const int n = sizeof(table) / sizeof(table[0]);
  if (mv >= table[0][0]) return 100;
  if (mv <= table[n - 1][0]) return 0;
  for (int i = 0; i < n - 1; i++) {
    if (mv <= table[i][0] && mv >= table[i + 1][0]) {
      const float t =
          float(table[i][0] - mv) / float(table[i][0] - table[i + 1][0]);
      return int(table[i][1] + t * (table[i + 1][1] - table[i][1]) + 0.5f);
    }
  }
  return 50;
}

/** Open-drain active-LOW with majority vote (LED noise / bounce). */
static bool readActiveLow(int pin) {
  int low = 0;
  for (int i = 0; i < 5; i++) {
    if (digitalRead(pin) == LOW) low++;
    delayMicroseconds(50);
  }
  return low >= 3;
}

void BatteryMonitor::begin(StatusFn onStatus) {
  _onStatus = onStatus;

  analogReadResolution(12);
  analogSetPinAttenuation(BAT_ADC_PIN, ADC_11db);
  pinMode(BAT_ADC_PIN, INPUT);
  pinMode(BAT_CHRG_PIN, INPUT_PULLUP);
  pinMode(BAT_STDBY_PIN, INPUT_PULLUP);

  Serial.println("[batt] TP4056 sense");
  Serial.println("[batt]   D8  ADC  ← mid of 10k+10k — %");
  Serial.println("[batt]   D9  CHRG ← still charging (USB on TC4056)");
  Serial.println("[batt]   D10 STDBY← full / USB still connected");

  delay(20);
  sample();
  emitIfChanged(true);
}

void BatteryMonitor::setIntervals(uint32_t sampleMs, uint32_t minEmitMs) {
  _sampleMs = sampleMs < 50 ? 50 : sampleMs;
  _minEmitMs = minEmitMs < 100 ? 100 : minEmitMs;
}

void BatteryMonitor::loop() {
  const uint32_t now = millis();
  if (now - _lastSampleMs < _sampleMs) return;
  _lastSampleMs = now;
  sample();
  emitIfChanged(false);
}

void BatteryMonitor::sample() {
  uint32_t sum = 0;
  const int n = 8;
  for (int i = 0; i < n; i++) {
    sum += analogRead(BAT_ADC_PIN);
    delayMicroseconds(200);
  }
  const float adc = sum / float(n);

  const float vadc = adc * (3.3f / 4095.0f);
  float mv = vadc * BAT_DIV_RATIO * 1000.0f * BAT_ADC_SCALE;

  if (!_filtReady) {
    _filtMv = mv;
    _filtReady = true;
  } else {
    _filtMv = _filtMv * 0.85f + mv * 0.15f;
  }

  _mv = int(_filtMv + 0.5f);
  _percent = mvToPercent(_mv);

  // CHRG low = still charging; STDBY low = charge done, USB still in
  _charging = readActiveLow(BAT_CHRG_PIN);
  _full = readActiveLow(BAT_STDBY_PIN);
  _usb = _charging || _full;
}

void BatteryMonitor::emitIfChanged(bool force) {
  const uint32_t now = millis();
  const bool changed = _percent != _lastEmittedPct || _usb != _lastEmittedUsb ||
                       _charging != _lastEmittedChg || _full != _lastEmittedFull;
  if (!force) {
    if (!changed && now - _lastEmitMs < 5000) return;
    if (changed && now - _lastEmitMs < _minEmitMs) return;
  }

  _lastEmittedPct = _percent;
  _lastEmittedUsb = _usb;
  _lastEmittedChg = _charging;
  _lastEmittedFull = _full;
  _lastEmitMs = now;

  Serial.printf("[batt] %d%% %dmV usb=%d charging=%d full=%d\n", _percent, _mv,
                _usb ? 1 : 0, _charging ? 1 : 0, _full ? 1 : 0);

  if (_onStatus) _onStatus(statusJson());
}

String BatteryMonitor::statusJson() const {
  JsonDocument doc;
  doc["batt"] = _percent;
  doc["mv"] = _mv;
  doc["usb"] = _usb;             // USB plugged into TC4056
  doc["charging"] = _charging;   // still charging (CHRG)
  doc["full"] = _full;           // charge complete (STDBY)
  String out;
  serializeJson(doc, out);
  return out;
}

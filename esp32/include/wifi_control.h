#pragma once

#include <Arduino.h>
#include <functional>

class WifiControl {
public:
  using StatusFn = std::function<void(const String &json)>;

  void begin(StatusFn onStatus);
  void loop();

  void connectAndSave(const String &ssid, const String &pass);
  void trySaved();
  void forgetSaved();
  /** Drop STA without wiping saved SSID/pass. */
  void disconnectSta();
  void startScan();

  bool isConnected() const;
  String localIp() const;
  String statusJson() const;

private:
  StatusFn _onStatus;
  bool _connecting = false;
  bool _scanning = false;
  bool _scanThenConnect = false;
  uint32_t _connectStartedMs = 0;
  uint8_t _connectAttempt = 0;
  String _ssid;
  String _pass;
  int _lastFailReason = 0;
  String _lastFailError;

  void emitStatus();
  void emitFail(const String &error);
  void emitScanResults(int n);
  void beginStaConnect();
  void startConnect(const String &ssid, const String &pass, bool save);
};

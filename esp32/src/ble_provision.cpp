#include "ble_provision.h"
#include "config.h"

#include <ArduinoJson.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

static BLECharacteristic *statusChar = nullptr;
static BLEServer *bleServer = nullptr;
static BleProvision *gBle = nullptr;

static String bleValueToString(BLECharacteristic *c) {
  return String(c->getValue().c_str());
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    Serial.println("[ble] ON — phone connected");
    if (gBle) gBle->onBleConnect();
  }
  void onDisconnect(BLEServer *server) override {
    Serial.println("[ble] phone disconnected — stop + re-advertise");
    if (gBle) gBle->onBleDisconnect();
  }
};

class SsidCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    if (gBle) gBle->onWriteSsid(bleValueToString(c));
  }
};

class PassCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    if (gBle) gBle->onWritePass(bleValueToString(c));
  }
};

class CmdCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    if (gBle) gBle->onWriteCmd(bleValueToString(c));
  }
};

class ControlCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    if (gBle) gBle->onWriteControl(bleValueToString(c));
  }
};

void BleProvision::onWriteSsid(const String &value) {
  _ssid = value;
  _ssid.trim();
  Serial.printf("[ble] ssid set (%u chars)\n", (unsigned)_ssid.length());
}

void BleProvision::onWritePass(const String &value) {
  _pass = value;
  Serial.printf("[ble] pass set (%u chars)\n", (unsigned)_pass.length());
}

void BleProvision::onWriteCmd(const String &value) {
  String cmd = value;
  cmd.trim();
  cmd.toLowerCase();
  Serial.printf("[ble] cmd: %s\n", cmd.c_str());
  if (cmd == "connect" || cmd == "1") {
    if (_ssid.length() == 0) {
      notifyStatus("{\"wifi\":\"failed\",\"error\":\"empty_ssid\"}");
      return;
    }
    _pendingConnect = true;
  } else if (cmd == "status") {
    if (_wifi) notifyStatus(_wifi->statusJson());
  } else if (cmd == "scan") {
    if (_wifi) _wifi->startScan();
  } else if (cmd == "forget") {
    if (_wifi) _wifi->forgetSaved();
  }
}

void BleProvision::onWriteControl(const String &value) {
  Serial.printf("[ble] control: %s\n", value.c_str());

  JsonDocument doc;
  if (deserializeJson(doc, value)) {
    Serial.println("[ble] control bad json");
    return;
  }

  const char *cmd = doc["cmd"] | "";

  if (strcmp(cmd, "steer") == 0 && doc["angle"].is<int>() && _servo) {
    _servo->setAngle(doc["angle"].as<int>());
  } else if (doc["steer"].is<int>() && _servo) {
    _servo->setAngle(doc["steer"].as<int>());
  } else if (strcmp(cmd, "center") == 0 && _servo) {
    _servo->setAngle(SERVO_CENTER);
  } else if (strcmp(cmd, "drive") == 0 && _motors) {
    int left = doc["left"] | 0;
    int right = doc["right"] | 0;
    Serial.printf("[ble] drive L=%d R=%d\n", left, right);
    _motors->setBoth(left, right);
  } else if (strcmp(cmd, "stop") == 0) {
    if (_motors) _motors->stop();
    if (_servo) _servo->setAngle(SERVO_CENTER);
  } else if (strcmp(cmd, "lights") == 0) {
    bool on = doc["on"] | false;
    Serial.printf("[ble] lights %s (wire LED pin later)\n", on ? "ON" : "OFF");
  }
}

void BleProvision::onBleConnect() {
  _clientConnected = true;
  _advertising = false;
}

void BleProvision::onBleDisconnect() {
  _clientConnected = false;
  if (_servo) _servo->setAngle(SERVO_CENTER);
  if (_motors) _motors->stop();
  delay(200);
  restartAdvertising();
}

void BleProvision::restartAdvertising() {
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  if (!adv) return;

  // Name must be in the PRIMARY advert so Windows Chrome shows "RC Car" (not Unknown)
  BLEAdvertisementData advData;
  advData.setFlags(0x06);
  advData.setName(BLE_DEVICE_NAME);
  adv->setAdvertisementData(advData);

  BLEAdvertisementData scanData;
  scanData.setName(BLE_DEVICE_NAME); // also in scan response
  scanData.setCompleteServices(BLEUUID(BLE_SERVICE_UUID));
  adv->setScanResponseData(scanData);

  adv->setScanResponse(true);
  adv->start();
  _advertising = true;
  Serial.printf("[ble] ON — advertising name=\"%s\"\n", BLE_DEVICE_NAME);
}

void BleProvision::begin(WifiControl *wifi, ServoControl *servo, MotorControl *motors) {
  _wifi = wifi;
  _servo = servo;
  _motors = motors;
  gBle = this;

  BLEDevice::init(BLE_DEVICE_NAME);
  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());

  BLEService *service = bleServer->createService(BLE_SERVICE_UUID);

  BLECharacteristic *ssidChar = service->createCharacteristic(
      BLE_SSID_UUID, BLECharacteristic::PROPERTY_WRITE);
  ssidChar->setCallbacks(new SsidCallbacks());

  BLECharacteristic *passChar = service->createCharacteristic(
      BLE_PASS_UUID, BLECharacteristic::PROPERTY_WRITE);
  passChar->setCallbacks(new PassCallbacks());

  BLECharacteristic *cmdChar = service->createCharacteristic(
      BLE_CMD_UUID, BLECharacteristic::PROPERTY_WRITE);
  cmdChar->setCallbacks(new CmdCallbacks());

  BLECharacteristic *controlChar = service->createCharacteristic(
      BLE_CONTROL_UUID,
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  controlChar->setCallbacks(new ControlCallbacks());

  statusChar = service->createCharacteristic(
      BLE_STATUS_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  statusChar->addDescriptor(new BLE2902());
  statusChar->setValue("{\"wifi\":\"disconnected\",\"ble\":\"on\"}");

  service->start();
  restartAdvertising();
  _lastHeartbeatMs = millis();
}

void BleProvision::loop() {
  if (_pendingConnect && _wifi) {
    _pendingConnect = false;
    _wifi->connectAndSave(_ssid, _pass);
  }

  // Heartbeat only — do NOT restart advertising every few seconds (breaks BLE control)
  if (millis() - _lastHeartbeatMs > 10000) {
    _lastHeartbeatMs = millis();
    if (_clientConnected) {
      Serial.println("[ble] ON — client connected (control ready)");
    } else {
      Serial.printf("[ble] ON — advertising \"%s\"\n", BLE_DEVICE_NAME);
    }
  }
}

void BleProvision::notifyStatus(const String &json) {
  if (!statusChar) return;
  statusChar->setValue(json.c_str());
  statusChar->notify();
  Serial.printf("[ble] status → %s\n", json.c_str());
}

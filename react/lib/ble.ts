/** Must match esp32/include/config.h */
export const BLE_DEVICE_NAME = "RC Car";
export const BLE_SERVICE_UUID = "c0de0001-0c10-4a1a-9c1e-00a1b2c3d4e5";
export const BLE_SSID_UUID = "c0de0002-0c10-4a1a-9c1e-00a1b2c3d4e5";
export const BLE_PASS_UUID = "c0de0003-0c10-4a1a-9c1e-00a1b2c3d4e5";
export const BLE_CMD_UUID = "c0de0004-0c10-4a1a-9c1e-00a1b2c3d4e5";
export const BLE_STATUS_UUID = "c0de0005-0c10-4a1a-9c1e-00a1b2c3d4e5";
export const BLE_CONTROL_UUID = "c0de0006-0c10-4a1a-9c1e-00a1b2c3d4e5";

export type WifiNetwork = { ssid: string; rssi?: number; secure?: boolean };

export type WifiStatus = {
  wifi?: "connected" | "connecting" | "disconnected" | "failed" | "scanning" | "scan";
  ip?: string;
  ssid?: string;
  ws?: string;
  stream?: string;
  error?: string;
  ble?: string;
  networks?: WifiNetwork[];
  attempt?: number;
  reason?: number;
};

export function isWebBluetoothAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

function encode(text: string): BufferSource {
  return new TextEncoder().encode(text);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Windows Chrome Web Bluetooth: only ONE GATT op at a time or you get NotSupportedError. */
class GattQueue {
  private chain: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    // Keep chain alive even if this op fails
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async write(
    char: BluetoothRemoteGATTCharacteristic,
    text: string,
    preferNr = false,
  ) {
    return this.run(async () => {
      const data = encode(text);
      let lastErr: unknown;
      for (let i = 0; i < 3; i++) {
        try {
          if (preferNr && char.properties.writeWithoutResponse) {
            await char.writeValueWithoutResponse(data);
          } else {
            await char.writeValue(data);
          }
          return;
        } catch (e) {
          lastErr = e;
          await sleep(80 + i * 120);
        }
      }
      throw lastErr instanceof Error
        ? lastErr
        : new Error("GATT operation failed for unknown reason.");
    });
  }

  async read(char: BluetoothRemoteGATTCharacteristic) {
    return this.run(async () => {
      let lastErr: unknown;
      for (let i = 0; i < 3; i++) {
        try {
          return await char.readValue();
        } catch (e) {
          lastErr = e;
          await sleep(80 + i * 120);
        }
      }
      throw lastErr instanceof Error
        ? lastErr
        : new Error("GATT read failed.");
    });
  }

  async startNotifications(char: BluetoothRemoteGATTCharacteristic) {
    return this.run(async () => {
      let lastErr: unknown;
      for (let i = 0; i < 3; i++) {
        try {
          await char.startNotifications();
          return;
        } catch (e) {
          lastErr = e;
          await sleep(120 + i * 150);
        }
      }
      throw lastErr instanceof Error
        ? lastErr
        : new Error("GATT notify failed.");
    });
  }
}

export async function connectBleDevice(): Promise<BluetoothDevice> {
  if (!isWebBluetoothAvailable()) {
    throw new Error("Web Bluetooth not supported — use Chrome/Edge on Android or desktop");
  }

  return navigator.bluetooth.requestDevice({
    filters: [{ name: BLE_DEVICE_NAME }, { namePrefix: "RC" }],
    optionalServices: [BLE_SERVICE_UUID],
  });
}

export async function openBleSession(device: BluetoothDevice): Promise<{
  server: BluetoothRemoteGATTServer;
  sendWifi: (ssid: string, password: string) => Promise<void>;
  sendControl: (payload: string) => Promise<void>;
  requestStatus: () => Promise<void>;
  requestScan: () => Promise<void>;
  disconnectWifi: () => Promise<void>;
  forgetWifi: () => Promise<void>;
  startNotify: (onStatus: (s: WifiStatus) => void) => Promise<() => void>;
}> {
  if (!device.gatt) throw new Error("No GATT server on device");

  const server = await device.gatt.connect();
  // Let the link settle — rushing causes "GATT operation failed for unknown reason"
  await sleep(350);

  const service = await server.getPrimaryService(BLE_SERVICE_UUID);
  const ssidChar = await service.getCharacteristic(BLE_SSID_UUID);
  const passChar = await service.getCharacteristic(BLE_PASS_UUID);
  const cmdChar = await service.getCharacteristic(BLE_CMD_UUID);
  const statusChar = await service.getCharacteristic(BLE_STATUS_UUID);
  const controlChar = await service.getCharacteristic(BLE_CONTROL_UUID);

  const q = new GattQueue();

  const sendWifi = async (ssid: string, password: string) => {
    await q.write(ssidChar, ssid);
    await sleep(40);
    await q.write(passChar, password);
    await sleep(40);
    await q.write(cmdChar, "connect");
  };

  const sendControl = async (payload: string) => {
    // Prefer write-without-response for continuous steering (still queued)
    await q.write(controlChar, payload, true);
  };

  const requestStatus = async () => {
    await q.write(cmdChar, "status");
  };

  const requestScan = async () => {
    await q.write(cmdChar, "scan");
  };

  const disconnectWifi = async () => {
    await q.write(cmdChar, "disconnect");
  };

  const forgetWifi = async () => {
    await q.write(cmdChar, "forget");
  };

  const startNotify = async (onStatus: (s: WifiStatus) => void) => {
    const handler = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const value = target.value;
      if (!value) return;
      const text = new TextDecoder().decode(value.buffer);
      try {
        onStatus(JSON.parse(text) as WifiStatus);
      } catch {
        onStatus({ wifi: "disconnected", error: text });
      }
    };
    statusChar.addEventListener("characteristicvaluechanged", handler);
    await q.startNotifications(statusChar);
    await sleep(80);
    // Optional initial read — ignore failure (notify will update)
    try {
      const v = await q.read(statusChar);
      const text = new TextDecoder().decode(v.buffer);
      onStatus(JSON.parse(text) as WifiStatus);
    } catch {
      /* ignore */
    }
    return () => {
      statusChar.removeEventListener("characteristicvaluechanged", handler);
      void statusChar.stopNotifications().catch(() => undefined);
    };
  };

  return {
    server,
    sendWifi,
    sendControl,
    requestStatus,
    requestScan,
    disconnectWifi,
    forgetWifi,
    startNotify,
  };
}

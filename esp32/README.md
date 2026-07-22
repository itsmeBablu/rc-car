# RC-Car ESP32 — Wi‑Fi only (Home / Direct / Setup)

**No Bluetooth.** Same React PWA works on Android, iPhone Safari, and desktop.

## Modes

| Mode | When | Hotspot / network | Drive? | OTA? |
|------|------|-------------------|--------|------|
| **Home** | Saved Wi‑Fi joins in ≤15 s | Your router | Yes | Yes |
| **Direct** | No router / STA fail | SoftAP `Porsche_RC_Car` / `12345678` @ `192.168.4.1` | Yes | No |
| **Setup** | No saved credentials (first time) | SoftAP `Porsche_RC_Setup` / `12345678` | Provision only | No |

Boot: try saved SSID → success = Home; fail = Direct. Never needs a router outdoors.

## HTTP

| Path | Purpose |
|------|---------|
| `GET /api/status` | mode, ip, ws, stream |
| `POST /api/wifi` | `{"ssid","password"}` (Setup portal) |
| `GET /api/battery` | batt / charging / usb / full |
| `GET /jpg` `/stream` | Camera |

WebSocket control: `ws://<ip>:81`

## Flash (USB)

```powershell
cd C:\Users\kanal\Desktop\rc-car\esp32
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -t upload --upload-port COM6
```

OTA (Home Mode only): `pio run -e ota -t upload --upload-port <car-ip>` password `rc-car-ota`.

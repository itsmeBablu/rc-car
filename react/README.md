# RC-Car React — BLE WiFi setup + servo control

## How it works

1. Stay on your normal WiFi (internet stays on)
2. Open the app in **Chrome or Edge** (Web Bluetooth — not Safari/iPhone)
3. **Connect Bluetooth** → pick **RC-Car**
4. Enter the venue WiFi name + password → **Send WiFi to car**
5. When status shows connected, steering uses WebSocket on the LAN

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (or your PC LAN IP on the phone, same WiFi).

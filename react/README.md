# GT2 RS · React cockpit (HTTP)

Control the car with this React UI over **HTTP on your LAN**.  
Do **not** use Vercel / HTTPS — browsers block `ws://` to the car from HTTPS pages.

## Phone control (same Wi‑Fi as car + PC)

1. Car on home Wi‑Fi (SoftAP stays available for setup).
2. Phone and PC on that **same** Wi‑Fi.
3. On the PC:

```bash
cd react
npm install
npm run dev
```

4. On the phone browser open:

```text
http://YOUR_PC_IP:3000
```

Example: PC `192.168.2.41` → `http://192.168.2.41:3000`

Find the PC IP: Windows `ipconfig` → IPv4. The localhost page also shows a **Phone control** banner with the link.

5. Tap **Link** → connect SoftAP or home IP → drive.

Windows Firewall: allow Node.js / port **3000** if the phone cannot load the page.

## SoftAP only (no home Wi‑Fi)

Phone on `Porsche_RC_Car` cannot reach your PC. Use the car page: `http://192.168.4.1/`  
Or join SoftAP from a laptop that runs this app.

## Scripts

| Command        | What it does                          |
|----------------|----------------------------------------|
| `npm run dev`  | HTTP on `0.0.0.0:3000` (PC + phone)   |
| `npm run start`| Production HTTP on `0.0.0.0:3000`     |

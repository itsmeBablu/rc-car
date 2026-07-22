# RC-Car ESP32 — wiring

## DRV8833 (your board silkscreen)

**Left edge (top → bottom):** `IN4 , IN3 , GND , VCC , IN2 , IN1`  
**Right edge (top → bottom):** `EEP , OUT1 , OUT2 , OUT3 , OUT4 , ULT`

### Power + enable (required)

| From | To DRV8833 label |
|------|------------------|
| TC4056 **OUT+** (rail+) | **VCC** |
| TC4056 **OUT-** (rail−) | **GND** |
| XIAO **D5** | **EEP** |

`ULT` = leave unconnected.

### Logic (XIAO → DRV — match the **names**, ignore vertical order)

| XIAO pin | DRV8833 label |
|----------|---------------|
| **D0** | **IN1** (bottom of left side) |
| **D1** | **IN2** |
| **D2** | **IN3** |
| **D3** | **IN4** (top of left side) |

Do **not** wire D0 to IN4 just because both are “near the top”.

### Motors

| DRV8833 | Motor |
|---------|--------|
| **OUT1** + **OUT2** | N20 Motor A (left) |
| **OUT3** + **OUT4** | N20 Motor B (right) |

### Servo (unchanged)

| From | To |
|------|-----|
| rail+ | servo red |
| rail− | servo brown |
| XIAO **D4** | servo orange |

## Battery (1S LiPo + TP4056)

**Do not use D5 for the divider** — D5 is motor **EEP**.

| From | To |
|------|-----|
| Cell **+** | TP4056 **B+** |
| Cell **−** | TP4056 **B−** |
| TP4056 **OUT+** | XIAO **5V** (and DRV **VCC** / servo red) |
| TP4056 **OUT−** | XIAO **GND** (and DRV **GND** / servo brown) — common ground |
| TP4056 **OUT+** | **R** → mid node (use **10k** or **220k**) |
| Mid node | XIAO **D8** (ADC) |
| Mid node | **same R** → **GND** (same as OUT−) |
| TP4056 **CHRG** | XIAO **D9** (LOW = charging) |
| TP4056 **STDBY** | XIAO **D10** (LOW = full / charge done) |

Use **two equal** resistors (1:1): **10k+10k** (best of what you have) or **220k+220k**. Do **not** mix 10k with 220k (wrong ratio / can over-volt the ADC). **1k** works as a pair but wastes more battery current — prefer 10k.

**D8 alone is not enough for the green CHG style** — that only reads voltage/%.  
Plug USB into the **TC4056** (not only the XIAO). Wire **CHRG→D9**. At ~100% the chip stops asserting CHRG and pulls **STDBY** low instead — wire **STDBY→D10** or the gauge stays non-green when full. On many boards, tap the **red LED** pad for CHRG and the **blue/green LED** pad for STDBY (cathode / chip side).

## Flash (USB)

```powershell
cd C:\Users\kanal\Desktop\rc-car\esp32
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -t upload --upload-port COM6
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" device monitor --port COM6
```

## Flash over WiFi (OTA)

1. Flash **once** over USB with this OTA build.
2. Join WiFi via Link so the car has an IP.
3. Then from PC (same WiFi):

```powershell
cd C:\Users\kanal\Desktop\rc-car\esp32
# use the IP shown in Link / serial ([ota] ready — …)
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -e ota -t upload --upload-port 192.168.1.50
```

Password: `rc-car-ota` (`OTA_PASSWORD` in `config.h`).

On boot watch serial for `[batt]`, and `[ota] ready` when WiFi is up.

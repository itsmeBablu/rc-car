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

## Flash

```powershell
cd C:\Users\kanal\Desktop\rc-car\esp32
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -t upload --upload-port COM6
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" device monitor --port COM6
```

On boot the firmware runs Motor A, then B, then both (full on ~0.3s each). Watch serial for `[motor] test A...`.

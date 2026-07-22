#include "drive_pump.h"
#include <Arduino.h>

static DrivePumpFn gPump = nullptr;

void setDrivePump(DrivePumpFn fn) { gPump = fn; }

void pumpDrive() {
  if (gPump) gPump();
  else yield();
}

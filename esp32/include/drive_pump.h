#pragma once

/** Call from long camera/HTTP work so WebSocket steer/drive stay responsive. */
using DrivePumpFn = void (*)();

void setDrivePump(DrivePumpFn fn);
void pumpDrive();

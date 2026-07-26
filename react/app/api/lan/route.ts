import { networkInterfaces } from "os";
import { NextResponse } from "next/server";

/** LAN IPv4s for phone access — http://IP:3000 (never HTTPS). */
export function GET() {
  const ips: string[] = [];
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const n of list) {
      if (n.family !== "IPv4" || n.internal) continue;
      if (n.address.startsWith("169.254.")) continue;
      ips.push(n.address);
    }
  }
  const port = Number(process.env.PORT || 3000);
  return NextResponse.json({
    protocol: "http",
    port,
    ips,
    urls: ips.map((ip) => `http://${ip}:${port}`),
  });
}

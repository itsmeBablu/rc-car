import { networkInterfaces } from "os";
import type { NextConfig } from "next";

function lanHosts(): string[] {
  const hosts = new Set<string>(["localhost", "127.0.0.1"]);
  for (const list of Object.values(networkInterfaces())) {
    if (!list) continue;
    for (const n of list) {
      if (n.family === "IPv4" && !n.internal && !n.address.startsWith("169.254.")) {
        hosts.add(n.address);
      }
    }
  }
  return [...hosts];
}

const nextConfig: NextConfig = {
  // Phone opens http://PC_LAN_IP:3000
  allowedDevOrigins: lanHosts(),
};

export default nextConfig;

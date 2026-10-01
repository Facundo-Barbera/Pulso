import { networkInterfaces } from "node:os";

/**
 * The Mac's Tailscale IPv4, read from the interface table (not `tailscale ip`,
 * whose binary may not be on Next's PATH). 100.64.0.0/10 is Tailscale's CGNAT
 * range; `null` when there is none, and callers then expose nothing.
 */
export function tailnetIp() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      const match = /^100\.(\d+)\./.exec(address.address);
      if (match && Number(match[1]) >= 64 && Number(match[1]) <= 127) return address.address;
    }
  }
  return null;
}

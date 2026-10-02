import { execFileSync } from "node:child_process";
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

// Launchd's PATH may not reach the CLI, so try where it installs too.
const TAILSCALE = ["tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];
let found;

/** The Tailscale CLI that answers and its `status --json`, read once. */
function probe() {
  if (found !== undefined) return found;
  found = null;
  for (const bin of TAILSCALE) {
    try {
      found = { bin, status: JSON.parse(execFileSync(bin, ["status", "--json"], { timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }).toString()) };
      break;
    } catch {}
  }
  return found;
}

export const tailscaleBin = () => probe()?.bin ?? null;

/** This Mac's MagicDNS name with an HTTPS certificate (`mini.tailnet.ts.net`), or `null` when Tailscale or its HTTPS is off. */
export function tailnetCertDomain() {
  const domains = probe()?.status?.CertDomains;
  return (Array.isArray(domains) && domains.find((d) => typeof d === "string" && d)) || null;
}

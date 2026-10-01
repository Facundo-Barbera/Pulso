import { TAILNET_PORT, type PairCode } from "@pulso/contract";
import { createPairingCode } from "@/src/devices";
import { tailnetIp } from "@/scripts/tailnet-ip.mjs";

export const dynamic = "force-dynamic";

/** Mints a pairing code. Not under /api/mobile, so the tailnet gate refuses it: only this Mac can. */
export function POST(): Response {
  const ip = tailnetIp();
  const body: PairCode = { ...createPairingCode(), address: ip ? `http://${ip}:${TAILNET_PORT}` : null };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

import { TAILNET_PORT, type DeviceKind, type PairCode } from "@pulso/contract";
import { tailnetIp } from "@/scripts/tailnet-ip.mjs";
import { createPairingCode } from "@/src/devices";
import { json, loopbackOnly } from "../../http";

export const dynamic = "force-dynamic";

/** Mints a pairing code for `{ kind: "phone" | "browser" }` (default phone). The Mac only. */
export async function POST(request: Request): Promise<Response> {
  const refused = loopbackOnly(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => ({}))) as { kind?: unknown };
  const kind: DeviceKind = body.kind === "browser" ? "browser" : "phone";
  const ip = tailnetIp();
  const code: PairCode = { ...createPairingCode(Date.now(), kind), address: ip ? `http://${ip}:${TAILNET_PORT}` : null };
  return json(code);
}

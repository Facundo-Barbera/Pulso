import { listDevices } from "@/src/devices";
import { json, loopbackOnly } from "../../http";

export const dynamic = "force-dynamic";

/** Every paired device, phones and browsers, newest first. The Mac only. */
export function GET(request: Request): Response {
  return loopbackOnly(request) ?? json({ devices: listDevices() });
}

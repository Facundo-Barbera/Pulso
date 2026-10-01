import { authenticate, type Device } from "@/src/devices";

export const NO_STORE = { "cache-control": "no-store" };

export const unpaired = () => Response.json({ code: "unauthorized", message: "This phone is not paired with Pulso." }, { status: 401, headers: NO_STORE });

export function deviceOf(request: Request): Device | undefined {
  return authenticate(request.headers.get("authorization"));
}

import { authenticate, type Device } from "@/src/devices";

export const NO_STORE = { "cache-control": "no-store" };

export const unpaired = () => Response.json({ code: "unauthorized", message: "This phone is not paired with Pulso." }, { status: 401, headers: NO_STORE });

/** The paired phone behind the bearer. Only devices holding the `mobile` scope: a browser's token is not a phone. */
export function deviceOf(request: Request): Device | undefined {
  const device = authenticate(request.headers.get("authorization"));
  return device?.scopes.includes("mobile") ? device : undefined;
}

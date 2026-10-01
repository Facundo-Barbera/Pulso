import { VIA_HEADER } from "@pulso/contract";

/**
 * What the tailnet may reach. Loopback (no via header) is this Mac and is
 * trusted. From the tailnet only two things answer:
 *   - `POST /api/mobile/pair`: the 8-digit code is the credential.
 *   - `/api/mobile/*`: each route checks the phone's bearer itself.
 * Everything else (the window, code minting, device admin) is the Mac's alone.
 */
export type Verdict = { allow: true } | { allow: false; status: 403; reason: string };

export function fromTailnet(headers: { get(name: string): string | null }): boolean {
  return headers.get(VIA_HEADER) === "tailnet";
}

export function gate(pathname: string): Verdict {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/api/mobile" || path.startsWith("/api/mobile/")) return { allow: true };
  return { allow: false, status: 403, reason: "this only answers on the Mac running Pulso" };
}

import type { Scope } from "@pulso/contract";
import { VIA_HEADER } from "@pulso/contract";
import { isMcpPath } from "./mcp/paths";

/**
 * What the tailnet may reach. Pure, so `proxy.ts` stays a few lines and this is tested.
 *
 * The tailnet proxy (`scripts/tailnet-proxy.mjs`) stamps every request it
 * forwards with `x-pulso-via: tailnet` and drops any copy a client sent, so a
 * request without it came over loopback — the Electron window, a curl on this
 * Mac — and is trusted. From the tailnet a request is one of:
 *
 *   public   pairing: the phone's `POST /api/mobile/pair` and a browser's
 *            `/pair` form. The 8-digit code is the credential, and only the
 *            Mac can mint one.
 *   phone    `/api/mobile/*`: each route checks the phone's bearer itself
 *            (`deviceOf` in `app/api/mobile/auth.ts`).
 *   agents   the MCP endpoint (`isMcpPath`): it checks its own client secret.
 *   scoped   the web app — pages, `/_next/*`, static files (`view`) — and
 *            `/api/web/*` (`view` to read, `edit` to write). The device behind
 *            the cookie must hold the scope; no device is a 401.
 *   admin    `/api/web/admin/*` (codes, the device list, revoking) and any
 *            other `/api` path: a 403 whatever the device. The Mac's alone.
 */
export type Verdict = { allow: true } | { allow: false; status: 401 | 403; reason: string };
type Need = Scope | "admin";

/** `/api/web` paths whose need is not the default (read → view, write → edit). Exact paths. */
const WEB_EXCEPTIONS: Record<string, { read: Need; write: Need }> = {
  // A browser may always forget itself, e.g. a friend's computer when done.
  "/api/web/me": { read: "view", write: "view" },
};

export function fromTailnet(headers: { get(name: string): string | null }): boolean {
  return headers.get(VIA_HEADER) === "tailnet";
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** What a request needs, before looking at who sent it. `public` passes everyone. */
export function needOf(method: string, pathname: string): Need | "public" {
  const upper = method.toUpperCase();
  const read = upper === "GET" || upper === "HEAD";
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/pair" && (read || upper === "POST")) return "public";
  if (under(path, "/api/mobile")) return "public";
  // External agents: the MCP endpoint checks its own client secret.
  if (isMcpPath(path)) return "public";
  if (under(path, "/api/web/admin")) return "admin";
  if (under(path, "/api/web")) {
    const rule = WEB_EXCEPTIONS[path];
    return rule ? (read ? rule.read : rule.write) : read ? "view" : "edit";
  }
  if (under(path, "/api")) return "admin";
  // The web app itself: its HTML, `/_next/*` chunks, the icon. Non-GETs here are page actions.
  return read ? "view" : "edit";
}

/** `device` is the paired device behind the cookie or bearer, looked up by the caller: the gate itself does not read the database. */
export function gate(input: { method: string; pathname: string; device?: { scopes: readonly Scope[] } }): Verdict {
  const need = needOf(input.method, input.pathname);
  if (need === "public") return { allow: true };
  if (need === "admin") return { allow: false, status: 403, reason: "Esto sólo responde en la Mac que corre Pulso." };
  if (!input.device) return { allow: false, status: 401, reason: "Este navegador no está emparejado con Pulso: abre /pair." };
  if (!input.device.scopes.includes(need)) return { allow: false, status: 403, reason: `Este dispositivo no tiene permiso «${need}».` };
  return { allow: true };
}

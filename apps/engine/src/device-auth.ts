/**
 * Which device is asking: the cookie a paired browser carries, the bearer a
 * phone carries, or neither, which on loopback means this Mac itself.
 *
 * A browser pairs at `/pair` (`app/pair/route.ts`) and gets its token as an
 * `HttpOnly; SameSite=Lax` cookie: page script cannot read it, and other
 * sites' pages cannot send it with a write. Lax rather than Strict so a link
 * to Pulso opened from elsewhere lands on the app, not on the pair form; writes
 * are covered by the Origin check below. No `Secure`: the tailnet port is
 * plain HTTP and WireGuard is what encrypts it.
 */
import { HOST_HEADER } from "@pulso/contract";
import { deviceByToken, type Device } from "./devices";

export const COOKIE = "pulso_device";
/** Browsers cap a cookie's life at 400 days; revocation, not expiry, is what ends it. */
const COOKIE_MAX_AGE_S = 400 * 24 * 3600;

type Headers = { get(name: string): string | null };

export function cookieToken(header: string | null | undefined): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE && value.length) return value.join("=") || undefined;
  }
  return undefined;
}

export const setCookie = (token: string) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_S}`;
export const CLEAR_COOKIE = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export type Caller = { device: Device; via: "cookie" | "bearer" } | { device: undefined; via: "cookie" | "none" };

/** The paired device behind the request. A cookie that names nobody (revoked, forged) is reported, so the answer can clear it. */
export function callerOf(headers: Headers, now = Date.now()): Caller {
  const bearer = /^Bearer\s+(\S+)$/i.exec(headers.get("authorization") ?? "")?.[1];
  if (bearer) {
    const device = deviceByToken(bearer, now);
    if (device) return { device, via: "bearer" };
  }
  const token = cookieToken(headers.get("cookie"));
  if (!token) return { device: undefined, via: "none" };
  const device = deviceByToken(token, now);
  return device ? { device, via: "cookie" } : { device: undefined, via: "cookie" };
}

/**
 * A write carrying the cookie must come from Pulso's own page. SameSite keeps
 * other sites' pages from sending it on a POST; this is the second lock. The
 * tailnet proxy rewrites `Host`, so the one the browser wrote comes as `x-pulso-host`.
 */
export function sameOrigin(method: string, headers: Headers): boolean {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") return true;
  const host = headers.get(HOST_HEADER);
  const origin = headers.get("origin");
  return Boolean(host && origin && origin === `http://${host}`);
}

/** Where pairing sends the browser: only a path on this site. `next` comes from the URL and must not lead elsewhere. */
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || value.startsWith("/pair")) return "/";
  return value;
}

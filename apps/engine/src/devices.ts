import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { DeviceKind, PairedDevice, PairResponse, Scope } from "@pulso/contract";
import { db } from "./db";

const CODE_TTL_MS = 5 * 60_000;
/** Wrong codes tolerated before every live code is burned: 8 digits in 5 minutes is not guessable, unlimited tries would be. */
const MAX_MISSES = 5;
/** `last_seen_at` is written at most this often: the gate looks a browser up on every chunk it loads. */
const SEEN_EVERY_MS = 60_000;

export const DEVICE_KINDS: readonly DeviceKind[] = ["phone", "browser"];
export const SCOPES: readonly Scope[] = ["mobile", "view", "edit"];
export const DEFAULT_SCOPES: Record<DeviceKind, Scope[]> = { phone: ["mobile"], browser: ["view", "edit"] };

export type Device = PairedDevice;

export class PairingError extends Error {
  constructor(
    readonly code: "invalid_code" | "expired_code",
    message: string,
  ) {
    super(message);
  }
}

// Only the hash is stored: a leaked database does not leak working tokens.
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

type Row = { id: string; name: string; kind: string; scopes: string | null; paired_at: number; last_seen_at: number | null };
const COLUMNS = "id, name, kind, scopes, paired_at, last_seen_at";

function toDevice(row: Row): Device {
  const kind = DEVICE_KINDS.includes(row.kind as DeviceKind) ? (row.kind as DeviceKind) : "phone";
  let scopes = DEFAULT_SCOPES[kind];
  if (row.scopes) {
    try {
      scopes = (JSON.parse(row.scopes) as unknown[]).filter((s): s is Scope => SCOPES.includes(s as Scope));
    } catch {}
  }
  return { id: row.id, name: row.name, kind, scopes, pairedAt: row.paired_at, lastSeenAt: row.last_seen_at };
}

const misses = () => ((globalThis as Record<string, unknown>).__pulso_pair_misses__ as number | undefined) ?? 0;
const setMisses = (n: number) => ((globalThis as Record<string, unknown>).__pulso_pair_misses__ = n);

/** An 8-digit, single-use code for one kind of device, valid five minutes. Minted on the Mac only. */
export function createPairingCode(now = Date.now(), kind: DeviceKind = "phone"): { code: string; expiresAt: number; kind: DeviceKind } {
  const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
  const expiresAt = now + CODE_TTL_MS;
  db().query("DELETE FROM pairing_codes WHERE expires_at < ?").run(now);
  db().query("INSERT OR REPLACE INTO pairing_codes (code, expires_at, kind) VALUES (?, ?, ?)").run(code, expiresAt, kind);
  setMisses(0);
  return { code, expiresAt, kind };
}

/**
 * Trades a code for a device token. The token is returned this once and never
 * again. A code pairs only the kind it was minted for, so one shown for the
 * iPhone cannot pair a browser.
 */
export function redeemPairing(input: { code: string; name: string; kind?: DeviceKind }, now = Date.now()): PairResponse {
  const kind = input.kind ?? "phone";
  const code = input.code.replace(/\D/g, "");
  if (code.length !== 8) throw new PairingError("invalid_code", "El código tiene 8 dígitos.");
  const row = db().query<{ expires_at: number; kind: string }, [string]>("SELECT expires_at, kind FROM pairing_codes WHERE code = ?").get(code);
  // Single use whether it worked or not.
  db().query("DELETE FROM pairing_codes WHERE code = ?").run(code);
  if (!row || row.kind !== kind) {
    setMisses(misses() + 1);
    if (misses() >= MAX_MISSES) {
      db().query("DELETE FROM pairing_codes").run();
      setMisses(0);
    }
    throw new PairingError("invalid_code", "Ese código no vale. Genera uno nuevo en la Mac.");
  }
  if (row.expires_at < now) throw new PairingError("expired_code", "Ese código caducó. Genera uno nuevo en la Mac.");

  const token = randomBytes(32).toString("base64url");
  const name = input.name.trim().slice(0, 80) || (kind === "phone" ? "iPhone" : "Navegador");
  const device = { deviceId: randomUUID(), name, token };
  db()
    .query("INSERT INTO devices (id, name, token_hash, paired_at, last_seen_at, kind, scopes) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(device.deviceId, name, hash(token), now, now, kind, JSON.stringify(DEFAULT_SCOPES[kind]));
  return device;
}

/** The device behind a raw token (a phone's bearer or a browser's cookie), or undefined. */
export function deviceByToken(token: string | undefined, now = Date.now()): Device | undefined {
  if (!token) return undefined;
  const row = db().query<Row, [string]>(`SELECT ${COLUMNS} FROM devices WHERE token_hash = ?`).get(hash(token));
  if (!row) return undefined;
  if (row.last_seen_at === null || now - row.last_seen_at >= SEEN_EVERY_MS) {
    db().query("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now, row.id);
    row.last_seen_at = now;
  }
  return toDevice(row);
}

/** The device behind `Authorization: Bearer <token>`, or undefined. */
export function authenticate(header: string | null | undefined, now = Date.now()): Device | undefined {
  return deviceByToken(/^Bearer\s+(.+)$/i.exec(header ?? "")?.[1]?.trim(), now);
}

export function listDevices(): Device[] {
  return db().query<Row, []>(`SELECT ${COLUMNS} FROM devices ORDER BY paired_at DESC`).all().map(toDevice);
}

export function forgetDevice(id: string): boolean {
  return db().query("DELETE FROM devices WHERE id = ?").run(id).changes > 0;
}

import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { PairResponse } from "@pulso/contract";
import { db } from "./db";

const CODE_TTL_MS = 5 * 60_000;

export type Device = { id: string; name: string; pairedAt: number };

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

/** An 8-digit, single-use code, valid five minutes. Minted on the Mac only. */
export function createPairingCode(now = Date.now()): { code: string; expiresAt: number } {
  const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
  const expiresAt = now + CODE_TTL_MS;
  db().query("DELETE FROM pairing_codes WHERE expires_at < ?").run(now);
  db().query("INSERT OR REPLACE INTO pairing_codes (code, expires_at) VALUES (?, ?)").run(code, expiresAt);
  return { code, expiresAt };
}

/** Trades a code for a device token. The token is returned this once and never again. */
export function redeemPairing(input: { code: string; name: string }, now = Date.now()): PairResponse {
  const code = input.code.replace(/\D/g, "");
  if (code.length !== 8) throw new PairingError("invalid_code", "The code has 8 digits.");
  const row = db().query<{ expires_at: number }, [string]>("SELECT expires_at FROM pairing_codes WHERE code = ?").get(code);
  // Single use whether it worked or not.
  db().query("DELETE FROM pairing_codes WHERE code = ?").run(code);
  if (!row) throw new PairingError("invalid_code", "That code is not valid. Generate a new one on the Mac.");
  if (row.expires_at < now) throw new PairingError("expired_code", "That code expired. Generate a new one on the Mac.");

  const token = randomBytes(32).toString("base64url");
  const device = { deviceId: randomUUID(), name: input.name.trim().slice(0, 80) || "iPhone", token };
  db().query("INSERT INTO devices (id, name, token_hash, paired_at) VALUES (?, ?, ?, ?)").run(device.deviceId, device.name, hash(token), now);
  return device;
}

/** The device behind `Authorization: Bearer <token>`, or undefined. */
export function authenticate(header: string | null | undefined, now = Date.now()): Device | undefined {
  const token = /^Bearer\s+(.+)$/i.exec(header ?? "")?.[1]?.trim();
  if (!token) return undefined;
  const row = db()
    .query<{ id: string; name: string; paired_at: number }, [string]>("SELECT id, name, paired_at FROM devices WHERE token_hash = ?")
    .get(hash(token));
  if (!row) return undefined;
  db().query("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now, row.id);
  return { id: row.id, name: row.name, pairedAt: row.paired_at };
}

export function listDevices(): (Device & { lastSeenAt: number | null })[] {
  return db()
    .query<{ id: string; name: string; paired_at: number; last_seen_at: number | null }, []>("SELECT id, name, paired_at, last_seen_at FROM devices ORDER BY paired_at DESC")
    .all()
    .map((row) => ({ id: row.id, name: row.name, pairedAt: row.paired_at, lastSeenAt: row.last_seen_at }));
}

export function forgetDevice(id: string): void {
  db().query("DELETE FROM devices WHERE id = ?").run(id);
}

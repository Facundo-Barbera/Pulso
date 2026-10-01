import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { db } from "./db";
import { migrateDevices } from "./devices-schema";
import { authenticate, createPairingCode, forgetDevice, listDevices, PairingError, redeemPairing } from "./devices";

describe("pairing", () => {
  test("a code pairs once and the token authenticates", () => {
    const { code } = createPairingCode();
    const paired = redeemPairing({ code, name: "Test iPhone" });
    expect(paired.name).toBe("Test iPhone");
    expect(authenticate(`Bearer ${paired.token}`)?.id).toBe(paired.deviceId);
    expect(() => redeemPairing({ code, name: "again" })).toThrow(PairingError);
  });

  test("an expired code is refused", () => {
    const { code } = createPairingCode(Date.now() - 10 * 60_000);
    expect(() => redeemPairing({ code, name: "late" })).toThrow(expect.objectContaining({ code: "expired_code" }));
  });

  test("wrong tokens and forgotten devices do not authenticate", () => {
    expect(authenticate("Bearer nope")).toBeUndefined();
    expect(authenticate(null)).toBeUndefined();
    const paired = redeemPairing({ code: createPairingCode().code, name: "gone" });
    forgetDevice(paired.deviceId);
    expect(authenticate(`Bearer ${paired.token}`)).toBeUndefined();
  });

  test("a phone pairs with the phone's kind and scopes", () => {
    const paired = redeemPairing({ code: createPairingCode().code, name: "iPhone de prueba" });
    expect(authenticate(`Bearer ${paired.token}`)).toMatchObject({ kind: "phone", scopes: ["mobile"] });
  });
});

describe("devices from before browsers", () => {
  test("old rows gain kind and scopes and read as phones", () => {
    const old = new Database(":memory:");
    old.exec("CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, paired_at INTEGER NOT NULL, last_seen_at INTEGER)");
    old.exec("CREATE TABLE pairing_codes (code TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)");
    old.exec("INSERT INTO devices VALUES ('a', 'iPhone', 'h', 1, NULL)");
    migrateDevices(old);
    migrateDevices(old);
    expect(old.query("SELECT kind, scopes FROM devices").get()).toEqual({ kind: "phone", scopes: null });
    // And a row with no scopes reads with its kind's defaults.
    db().query("INSERT INTO devices (id, name, token_hash, paired_at) VALUES ('legacy', 'Viejo', 'legacy-hash', 1)").run();
    expect(listDevices().find((d) => d.id === "legacy")).toMatchObject({ kind: "phone", scopes: ["mobile"] });
  });
});

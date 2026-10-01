import { describe, expect, test } from "bun:test";
import { authenticate, createPairingCode, forgetDevice, PairingError, redeemPairing } from "./devices";

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
    expect(() => redeemPairing({ code, name: "late" })).toThrow("expired");
  });

  test("wrong tokens and forgotten devices do not authenticate", () => {
    expect(authenticate("Bearer nope")).toBeUndefined();
    expect(authenticate(null)).toBeUndefined();
    const paired = redeemPairing({ code: createPairingCode().code, name: "gone" });
    forgetDevice(paired.deviceId);
    expect(authenticate(`Bearer ${paired.token}`)).toBeUndefined();
  });
});

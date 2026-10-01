import { afterEach, expect, test } from "bun:test";
import { childEnv, claudeExecutable, ProviderMissingError, providerEnv, resetProvider } from "./provider";

afterEach(resetProvider);

const keychain = (values: Record<string, string>) => (account: string) => values[account];

test("the Keychain provider wins over the engine's own environment", () => {
  const env = providerEnv(keychain({ "anthropic-base-url": "http://127.0.0.1:8317", "anthropic-auth-token": "sk-kc" }), { ANTHROPIC_API_KEY: "sk-env" });
  expect(env).toEqual({ ANTHROPIC_BASE_URL: "http://127.0.0.1:8317", ANTHROPIC_AUTH_TOKEN: "sk-kc" });
});

test("without a Keychain entry, a credential from the engine's environment is used", () => {
  expect(providerEnv(keychain({}), { CLAUDE_CODE_OAUTH_TOKEN: "oat", HOME: "/x" })).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: "oat" });
});

test("no credential anywhere is a clear error, not a silent fall back to the Mac's OAuth", () => {
  expect(() => providerEnv(keychain({}), { ANTHROPIC_BASE_URL: "http://x" })).toThrow(ProviderMissingError);
});

test("the child env drops a parent Claude session's variables and keeps the rest", () => {
  const env = childEnv(
    { ANTHROPIC_AUTH_TOKEN: "sk-kc" },
    { HOME: "/h", PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CONFIG_DIR: "/c", ANTHROPIC_BASE_URL: "http://parent", ANTHROPIC_AUTH_TOKEN: "sk-parent" },
  );
  expect(env).toEqual({ HOME: "/h", PATH: "/bin", ANTHROPIC_AUTH_TOKEN: "sk-kc" });
});

test("the installed CLI is preferred, the bundled binary is the fallback", () => {
  expect(claudeExecutable({ PULSO_CLAUDE_BIN: "/opt/claude" }, (f) => f === "/opt/claude")).toBe("/opt/claude");
  expect(claudeExecutable({}, () => false)).toBeUndefined();
});

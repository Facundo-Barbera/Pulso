/**
 * How the Coach reaches Claude — the way Telar runs its agents.
 *
 * Telar does not let the Agent SDK fall back to this Mac's OAuth login (it
 * expires and cannot always be refreshed from a background process). It
 * resolves the person's installed `claude` CLI, builds the child's
 * environment from scratch, and overlays a configured provider: here,
 * ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN pointing at the local
 * CLIProxyAPI. Pulso keeps that provider in the macOS Keychain
 * (`bun run agent:provider` writes it), never in a file.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const KEYCHAIN_SERVICE = "Pulso Claude provider";
const KEYCHAIN_ACCOUNTS = { baseUrl: "anthropic-base-url", authToken: "anthropic-auth-token" } as const;

/** Credentials a provider may carry. Any of them is enough. */
const CREDENTIAL_ENV = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] as const;

export type ProviderEnv = Record<string, string>;
type Env = Record<string, string | undefined>;

export class ProviderMissingError extends Error {
  constructor() {
    super("El Coach no tiene cómo hablar con Claude. En la Mac corre `bun run agent:provider -- <url> <token>` desde apps/engine.");
  }
}

function keychainRead(account: string): string | undefined {
  const out = spawnSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"], { encoding: "utf8" });
  const value = out.status === 0 ? out.stdout.trim() : "";
  return value || undefined;
}

export function keychainWrite(account: keyof typeof KEYCHAIN_ACCOUNTS, value: string): void {
  const out = spawnSync("security", ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNTS[account], "-w", value]);
  if (out.status !== 0) throw new Error(`could not write ${account} to the Keychain`);
}

let cached: ProviderEnv | undefined;

/**
 * The provider overlay: the Keychain entry first, then whatever credential the
 * engine itself was started with. Cached per process; `resetProvider()` drops it.
 */
export function providerEnv(read: (account: string) => string | undefined = keychainRead, ambient: Env = process.env): ProviderEnv {
  if (cached) return cached;
  const baseUrl = read(KEYCHAIN_ACCOUNTS.baseUrl);
  const authToken = read(KEYCHAIN_ACCOUNTS.authToken);
  let env: ProviderEnv = {};
  if (authToken) {
    env = { ANTHROPIC_AUTH_TOKEN: authToken, ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {}) };
  } else {
    for (const name of [...CREDENTIAL_ENV, "ANTHROPIC_BASE_URL"]) {
      const value = ambient[name]?.trim();
      if (value) env[name] = value;
    }
    if (!CREDENTIAL_ENV.some((name) => env[name])) throw new ProviderMissingError();
  }
  cached = env;
  return env;
}

export function resetProvider(): void {
  cached = undefined;
}

/**
 * The child's environment: the engine's, minus anything a parent Claude Code
 * session or another provider left behind, plus the provider overlay.
 */
export function childEnv(provider: ProviderEnv, ambient: Env = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(ambient)) {
    if (value === undefined) continue;
    if (name === "CLAUDECODE" || name.startsWith("CLAUDE_") || name.startsWith("ANTHROPIC_")) continue;
    env[name] = value;
  }
  return { ...env, ...provider };
}

/** The person's installed `claude`, like Telar's `requireCli("claude")`; undefined means the SDK's bundled binary. */
export function claudeExecutable(ambient: Env = process.env, exists: (file: string) => boolean = fs.existsSync): string | undefined {
  const candidates = [
    ambient.PULSO_CLAUDE_BIN,
    path.join(os.homedir(), ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  return candidates.find((file): file is string => !!file && exists(file));
}

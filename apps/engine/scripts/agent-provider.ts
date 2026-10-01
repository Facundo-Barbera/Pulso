/**
 * Stores the Coach's Claude provider in the macOS Keychain.
 *
 *   bun run agent:provider -- <base-url> <auth-token>
 *   bun run agent:provider            (takes ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN from this shell)
 */
import { keychainWrite } from "../src/agent/provider";

const [baseUrl = process.env.ANTHROPIC_BASE_URL, authToken = process.env.ANTHROPIC_AUTH_TOKEN] = process.argv.slice(2);
if (!authToken) {
  console.error("Usage: bun run agent:provider -- <base-url> <auth-token>");
  process.exit(1);
}
if (baseUrl) keychainWrite("baseUrl", baseUrl);
keychainWrite("authToken", authToken);
console.log(`Saved the Coach's provider${baseUrl ? ` (${baseUrl})` : ""} in the Keychain. Restart the engine to use it.`);

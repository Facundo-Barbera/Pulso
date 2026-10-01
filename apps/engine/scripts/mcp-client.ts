/**
 * Creates an MCP client for another agent and prints its secret (shown once)
 * with ready-to-paste config. Read-only unless --write.
 *
 *   bun run mcp:client -- <name> [--write]
 */
import { ENGINE_PORT } from "@pulso/contract";
import { createClient } from "../src/mcp/clients";
import { connectionCard } from "../src/mcp/connection";

const args = process.argv.slice(2);
const name = args.filter((arg) => !arg.startsWith("--")).join(" ").trim();
if (!name) {
  console.error("Usage: bun run mcp:client -- <name> [--write]");
  process.exit(1);
}

const { client, secret } = createClient({ name, scope: args.includes("--write") ? "read+write" : "read" });
const card = connectionCard(secret, Number(process.env.PULSO_PORT) || ENGINE_PORT);

console.log(`Client "${client.name}" (${client.id}), scope ${client.scope}.`);
console.log(`Secret (shown only now): ${secret}\n`);
console.log(`On this Mac:\n  ${card.loopback.claudeCode}\n`);
if (card.tailnet) console.log(`From the tailnet (needs \`bun run tailnet\`):\n  ${card.tailnet.claudeCode}\n`);
console.log(`JSON:\n${card.loopback.json}`);

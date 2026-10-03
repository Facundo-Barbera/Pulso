/**
 * What a fresh Coach turn carries before the person says anything: the system
 * prompt, the tool schemas, the workspace context. Asks the Claude Code CLI
 * for its /context breakdown with the Coach's real options, without a model
 * call: the provider is pointed at an address nothing listens on, so nothing
 * can reach Anthropic, and no message is ever sent.
 *
 *   cd apps/engine && PULSO_DATA_DIR=$(mktemp -d) bun run scripts/coach-baseline.ts
 */
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { providerEnv } from "../src/agent/provider";

if (!process.env.PULSO_DATA_DIR) {
  console.error("Run it on a scratch data dir: PULSO_DATA_DIR=$(mktemp -d) bun run scripts/coach-baseline.ts");
  process.exit(1);
}
// Cached before anything reads the Keychain: an unreachable provider with a dummy key.
providerEnv(() => undefined, { ANTHROPIC_API_KEY: "offline", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" });

const { agentOptions } = await import("../src/agent/runner");
const { claudeMd, prepareWorkspace } = await import("../src/agent/workspace");
const { getProfile } = await import("../src/agent/profile");

const context = claudeMd(getProfile());
const abortController = new AbortController();
const options = agentOptions(prepareWorkspace(null, context), context, undefined, abortController);

// A prompt that never sends anything: the CLI starts, answers control requests and waits.
let release!: () => void;
const silent = (async function* (): AsyncGenerator<SDKUserMessage> {
  await new Promise<void>((resolve) => (release = resolve));
})();

const q = query({ prompt: silent, options });
try {
  // MCP servers connect in the background: wait for pulso before counting its tools.
  for (let i = 0; i < 50 && !(await q.mcpServerStatus()).some((s) => s.name === "pulso" && s.status === "connected"); i++) await Bun.sleep(100);
  const usage = await q.getContextUsage();
  const rows = (items: { name: string; tokens: number }[] | undefined) => (items ?? []).filter((r) => r.tokens > 0).map((r) => `  ${String(r.tokens).padStart(7)}  ${r.name}`);
  console.log(`model ${usage.model}: ${usage.totalTokens} tokens of ${usage.maxTokens} before the first message`);
  console.log(rows(usage.categories.filter((c) => c.kind === "used" || c.kind === "deferred").map((c) => ({ name: `${c.name}${c.kind === "deferred" ? " (deferred)" : ""}`, tokens: c.tokens }))).join("\n"));
  if (usage.systemPromptSections?.length) console.log(`system prompt sections:\n${rows(usage.systemPromptSections).join("\n")}`);
  if (usage.systemTools?.length) console.log(`built-in tools:\n${rows(usage.systemTools).join("\n")}`);
  const mcp = usage.mcpTools.reduce((sum, t) => sum + t.tokens, 0);
  const top = [...usage.mcpTools].sort((a, b) => b.tokens - a.tokens).slice(0, 10);
  console.log(`pulso tools: ${usage.mcpTools.length}, ${mcp} tokens; largest:\n${rows(top.map((t) => ({ name: t.name, tokens: t.tokens }))).join("\n")}`);
} finally {
  release?.();
  abortController.abort();
  q.close?.();
}

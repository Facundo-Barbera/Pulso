/**
 * What the model reads from a pulso tool, apart from what its action card gets.
 * Every result reaches the model leaned (no nulls, empty lists or empty
 * objects; numbers to 2 decimals), since each one stays in the context for
 * every later turn. A write tool's card gets the full value instead: what the
 * tool put under CARD_META, else its whole result, kept by tool_use id until
 * events.ts builds the card. Slimming a result never breaks a card or its undo.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isWrite } from "./actions";
import { CARD_META } from "./card";
import type { PulsoTool } from "./registry";

/** Claude Code names the tool_use behind each MCP call here. */
const TOOL_USE_META = "claudecode/toolUseId";
const KEEP = 200;

/** Drops null fields, empty arrays and empty objects, and rounds numbers to 2 decimals, all the way down. A null inside a list stays: its position may mean something. */
export function lean(value: unknown): unknown {
  if (typeof value === "number") return Number.isInteger(value) ? value : Math.round(value * 100) / 100;
  if (Array.isArray(value)) return value.map(lean).filter((v) => v !== undefined);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const kept = lean(v);
      if (kept === null || kept === undefined) continue;
      if (Array.isArray(kept) && kept.length === 0) continue;
      if (typeof kept === "object" && !Array.isArray(kept) && Object.keys(kept).length === 0) continue;
      out[key] = kept;
    }
    return out;
  }
  return value;
}

// tool_use id → the value its action card is built from.
const cards = new Map<string, unknown>();

/** The card value of a finished tool call, once; undefined when the tool kept none. */
export function takeCardData(toolUseId: string): unknown {
  const value = cards.get(toolUseId);
  cards.delete(toolUseId);
  return value;
}

function keepCard(toolUseId: string, value: unknown): void {
  cards.set(toolUseId, value);
  // A call whose result never came back must not pile up.
  if (cards.size > KEEP) cards.delete(cards.keys().next().value!);
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The result without its card value, for clients that read it whole (the external MCP server). */
export function withoutCard(result: CallToolResult): CallToolResult {
  if (!result._meta || !(CARD_META in result._meta)) return result;
  const { [CARD_META]: _card, ...meta } = result._meta;
  return Object.keys(meta).length ? { ...result, _meta: meta } : { content: result.content, ...(result.isError ? { isError: true } : {}) };
}

/** The tool as the Coach gets it: same name, schema and handler, leaned result, card value kept aside. */
export function forModel(tool: PulsoTool): PulsoTool {
  const write = isWrite(tool.name);
  return {
    ...tool,
    handler: async (args, extra) => {
      const result = await tool.handler(args, extra);
      const text = result.content.length === 1 && result.content[0]!.type === "text" ? result.content[0]!.text : null;
      const value = text === null || result.isError ? undefined : parse(text);
      const id = (extra as { _meta?: Record<string, unknown> } | undefined)?._meta?.[TOOL_USE_META];
      if (write && typeof id === "string") {
        const card = result._meta && CARD_META in result._meta ? result._meta[CARD_META] : value;
        if (card !== undefined) keepCard(id, card);
      }
      const bare = withoutCard(result);
      return value === undefined || typeof value !== "object" ? bare : { ...bare, content: [{ type: "text", text: JSON.stringify(lean(value)) }] };
    },
  };
}

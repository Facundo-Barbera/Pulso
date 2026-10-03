import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Where a tool hands its action card a value other than what the model reads (./model-results.ts). */
export const CARD_META = "pulso/card";

/** A result whose model text is `model` and whose action card is built from `card`. */
export const withCard = (model: unknown, card: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(model) }],
  _meta: { [CARD_META]: card as Record<string, unknown> },
});

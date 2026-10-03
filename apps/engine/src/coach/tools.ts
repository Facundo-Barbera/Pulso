import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { latestBrief } from "./store";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export const coachTools = [
  tool(
    "get_latest_brief",
    "The latest brief you wrote on your own: the morning brief (daily; period = its local date) or the Sunday check-in (weekly; period = that Sunday). text is Spanish Markdown; null if none yet. Read it when they bring up \"el resumen\" or \"lo de esta mañana\".",
    { kind: z.enum(["daily", "weekly"]).default("daily") },
    async ({ kind }) => {
      const brief = latestBrief(kind);
      return json(brief && { kind: brief.kind, period: brief.period, text: brief.text, writtenAt: new Date(brief.updatedAt).toISOString() });
    },
  ),
];

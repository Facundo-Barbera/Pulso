import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { latestBrief } from "./store";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export const coachTools = [
  tool(
    "get_latest_brief",
    "The latest brief you wrote on your own for the person: the morning brief (kind daily; period = its local date YYYY-MM-DD) or the Sunday weekly check-in (kind weekly; period = that Sunday). text is Markdown in Spanish; null when none exists yet. Read it when the person replies to or asks about \"el resumen\", \"lo de esta mañana\" or the weekly check-in, so you stay consistent with what you told them.",
    { kind: z.enum(["daily", "weekly"]).default("daily").describe("daily (morning brief) or weekly (Sunday check-in)") },
    async ({ kind }) => {
      const brief = latestBrief(kind);
      return json(brief && { kind: brief.kind, period: brief.period, text: brief.text, writtenAt: new Date(brief.updatedAt).toISOString() });
    },
  ),
];

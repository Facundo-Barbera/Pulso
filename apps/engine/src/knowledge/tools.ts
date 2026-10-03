import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { consultKnowledge, TOPICS } from "./store";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export const knowledgeTools = [
  tool(
    "consult_knowledge",
    "Search Pulso's curated evidence base: short Spanish cards from position stands and guidelines (ISSN, ACSM, WHO, AASM, ATA…) on nutrition, training, body composition, sleep, medication timing, supplements, alcohol and cannabis. " +
      "Each card: recommendations with numbers and units, when they apply, caveats, when to refer, evidence level (alta/moderada/baja), review date, sources. " +
      "Call it before any numeric recommendation. Returns the best matches, best first; an empty list means no card covers it.",
    {
      query: z.string().min(2).describe("Words or keywords, Spanish or English, e.g. \"proteína con semaglutida\""),
      topics: z.array(z.enum(TOPICS)).optional(),
      limit: z.number().int().min(1).max(5).default(2).describe("Up to 5 when the question spans several topics"),
    },
    async ({ query, topics, limit }) =>
      json({
        cards: consultKnowledge(query, { topics, limit }).map(({ card }) => ({
          id: card.id,
          title: card.title,
          topic: card.topic,
          evidence: card.evidence,
          reviewed: card.reviewed,
          content: card.body,
        })),
      }),
  ),
];

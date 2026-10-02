import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { consultKnowledge, TOPICS } from "./store";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export const knowledgeTools = [
  tool(
    "consult_knowledge",
    "Searches Pulso's curated evidence base: short Spanish cards distilled from position stands and guidelines (ISSN, ACSM, WHO, EFSA/IOM, AASM, ATA, GLP-1 nutrition advisories…) on nutrition, training, body composition, sleep and recovery, medication timing, supplements, alcohol and cannabis. " +
      "Each card has concrete recommendations (numbers and ranges with units), when they apply, caveats, when to refer to a professional, an evidence level (alta/moderada/baja), its review date and its sources. " +
      "Call it before giving any numeric recommendation (protein g/kg, deficit or rate of loss, sets per week, RIR, creatine or caffeine dose, sleep hours, water, fiber, when to take a medication, alcohol or cannabis and recovery). " +
      "query: the question in the person's words or keywords, Spanish or English. Returns the best-matching cards (default 3), best first; an empty list means no card covers it.",
    {
      query: z.string().min(2).describe("What you need, e.g. \"proteína con semaglutida\" or \"café y levotiroxina\""),
      topics: z.array(z.enum(TOPICS)).optional().describe("Narrow to these topics; omit to search everything"),
      limit: z.number().int().min(1).max(5).default(3),
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

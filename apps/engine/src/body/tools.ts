import { tool } from "@anthropic-ai/claude-agent-sdk";
import { BODY_METRICS } from "@pulso/contract";
import { z } from "zod";
import { parseDate } from "./fields";
import { addScan, listScans, projection, scanInputSchema, setGoal } from "./store";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

const metric = z
  .enum(BODY_METRICS)
  .describe("weight (kg), bodyFatMass (kg), skeletalMuscleMass (kg) or percentBodyFat (%)");

export const bodyTools = [
  tool(
    "list_body_scans",
    "Body-composition scans (InBody and manual entries), newest first. measuredAt is epoch ms. Units: weight, skeletalMuscleMass, bodyFatMass, softLeanMass, protein, mineral kg; percentBodyFat %; bmi kg/m²; bmr kcal/day; totalBodyWater and ICW/ECW litres; ecwRatio and waistHipRatio unitless; visceralFatLevel InBody level; inbodyScore points; segmental values kg (ECW per segment is a ratio). Null means not measured. Weight-only readings from Apple Health are not listed here; body_projection includes them.",
    { limit: z.number().int().min(1).max(200).default(20) },
    async ({ limit }) => text(listScans(limit).map(({ raw, ...scan }) => scan)),
  ),
  tool(
    "add_body_scan",
    "Save a body measurement the person tells you (e.g. read off an InBody sheet or a scale). Give at least weight, or two of skeletalMuscleMass / bodyFatMass / percentBodyFat. Units: kg for masses, % for percentBodyFat, kcal/day for bmr, litres for totalBodyWater. Missing body-fat kg or % is derived from the other plus weight. Confirm the numbers with the person before saving.",
    {
      date: z.string().optional().describe("When it was measured: YYYY-MM-DD or ISO date-time, local time. Defaults to now."),
      weight: z.number().optional(),
      skeletalMuscleMass: z.number().optional(),
      bodyFatMass: z.number().optional(),
      percentBodyFat: z.number().optional(),
      bmi: z.number().optional(),
      visceralFatLevel: z.number().optional(),
      bmr: z.number().optional(),
      totalBodyWater: z.number().optional(),
      ecwRatio: z.number().optional(),
      inbodyScore: z.number().optional(),
      waistHipRatio: z.number().optional(),
    },
    async ({ date, ...values }) => {
      const measuredAt = date === undefined ? Date.now() : parseDate(date);
      if (measuredAt === null) return fail(`Unreadable date "${date}". Use YYYY-MM-DD.`);
      const parsed = scanInputSchema.safeParse({ ...values, measuredAt, source: "manual" });
      if (!parsed.success) return fail(`Not saved: ${parsed.error.issues.map((i) => `${i.path.join(".") || "scan"}: ${i.message}`).join("; ")}`);
      const { raw, ...scan } = addScan(parsed.data);
      return text(scan);
    },
  ),
  tool(
    "body_projection",
    "Trend and projection for one metric from all scans plus Apple Health readings: current trend value, slopePerWeek, the value with an 80% band at 4, 8 and 12 weeks, and the goal ETA with a ready-to-say Spanish sentence. Pass target to ask 'when would I reach X' without saving a goal; otherwise the saved goal is used. current is null when there is too little data (needs 3+ days over 7+ days).",
    { metric, target: z.number().positive().optional().describe("Same unit as the metric.") },
    async ({ metric, target }) => {
      const { observed, band, ...summary } = projection(metric, target);
      return text({ ...summary, readings: observed.length, lastReading: observed.at(-1) ?? null });
    },
  ),
  tool(
    "set_body_goal",
    "Save (or clear, with target null) the person's goal for one metric. One goal per metric; the Cuerpo tab and body_projection show the ETA. Units: kg, or % for percentBodyFat.",
    { metric, target: z.number().positive().nullable() },
    async ({ metric, target }) => {
      const goal = setGoal(metric, target);
      return text(goal ? { goal, projection: projection(goal.metric).goal } : { cleared: metric });
    },
  ),
];

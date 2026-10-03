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
    "Body-composition scans (InBody and manual), newest first. measuredAt epoch ms. Units: weight, skeletalMuscleMass, bodyFatMass, softLeanMass, protein, mineral kg; percentBodyFat %; bmi kg/m²; bmr kcal/day; totalBodyWater, ICW, ECW litres; ecwRatio, waistHipRatio unitless; visceralFatLevel InBody level; inbodyScore points; segmental kg (segment ECW is a ratio). null = not measured. Apple Health weigh-ins are not here (body_projection uses them).",
    { limit: z.number().int().min(1).max(200).default(20) },
    async ({ limit }) => text(listScans(limit).map(({ raw, ...scan }) => scan)),
  ),
  tool(
    "add_body_scan",
    "Save a body measurement they tell you (an InBody sheet, a scale): at least weight, or two of skeletalMuscleMass / bodyFatMass / percentBodyFat. Units: masses kg, percentBodyFat %, bmr kcal/day, totalBodyWater litres. Missing body-fat kg or % is derived. Confirm the numbers with the person first.",
    {
      date: z.string().optional().describe("Local YYYY-MM-DD or ISO date-time; default now."),
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
    "Trend and projection for one metric from scans plus Apple Health: current trend value, slopePerWeek, values with an 80 % band at 4, 8 and 12 weeks, and the goal ETA with a Spanish sentence. target asks 'when would I reach X' without saving it (default the saved goal). current null with too little data (3+ days over 7+).",
    { metric, target: z.number().positive().optional().describe("The metric's unit.") },
    async ({ metric, target }) => {
      const { observed, band, ...summary } = projection(metric, target);
      return text({ ...summary, readings: observed.length, lastReading: observed.at(-1) ?? null });
    },
  ),
  tool(
    "set_body_goal",
    "Save the goal for one metric (null clears it); one per metric, its ETA shows in Cuerpo and body_projection.",
    { metric, target: z.number().positive().nullable() },
    async ({ metric, target }) => {
      const goal = setGoal(metric, target);
      return text(goal ? { goal, projection: projection(goal.metric).goal } : { cleared: metric });
    },
  ),
];

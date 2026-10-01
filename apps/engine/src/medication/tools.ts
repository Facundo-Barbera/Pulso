import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { localNow } from "./schedule";
import {
  addMedication,
  adherence,
  dateSchema,
  dosesBetween,
  listMedications,
  logDose,
  medicationDay,
  medicationInputSchema,
  medicationPatchSchema,
  timeSchema,
  updateMedication,
} from "./store";

/** Said once in every tool so the model sees the boundary wherever it starts. */
const BOUNDARY =
  "You may help organize schedules, set reminders and track doses exactly as the person describes them. " +
  "Never recommend starting, stopping, or changing a medication or its dose; for interactions, side effects or dosing questions, " +
  "point the person to their doctor or pharmacist.";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

/** Runs a handler, turning validation and not-found errors into a tool error the model can read. */
async function safely(run: () => unknown) {
  try {
    return json(await run());
  } catch (error) {
    return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

const SCHEDULE_HELP =
  "schedule: { asNeeded, times: local 24h 'HH:MM' list, days: ISO weekdays 1=Monday..7=Sunday, empty = every day }. " +
  "Dates are local 'YYYY-MM-DD'. stock counts doses left (each 'tomada' uses one); lowStockThreshold warns at or below it.";

export const medicationTools = [
  tool(
    "list_medications",
    `The person's medications and supplements with dose (amount + unit), form, instructions, schedule, start/end dates, stock and lowStock flag. ` +
      `Optionally includes today's dose slots with their status (pendiente/tomada/omitida/pospuesta). ${BOUNDARY}`,
    {
      includeInactive: z.boolean().default(false).describe("Also list paused medications."),
      includeToday: z.boolean().default(true).describe("Add today's slots and the next pending dose."),
    },
    async ({ includeInactive, includeToday }) =>
      safely(() => {
        const now = localNow();
        return { medications: listMedications({ includeInactive }), today: includeToday ? medicationDay(now.date, now.time) : undefined };
      }),
  ),
  tool(
    "add_medication",
    `Adds a medication or supplement the person says they take, exactly as they describe it (do not suggest doses). ` +
      `kind is 'medicamento' or 'suplemento'. ${SCHEDULE_HELP} Ask for the times if a scheduled med has none. ${BOUNDARY}`,
    medicationInputSchema.shape,
    async (input) => safely(() => addMedication(input)),
  ),
  tool(
    "update_medication",
    `Changes fields of a medication by id (only the ones given), when the person tells you something changed — new times, stock refill, ` +
      `instructions, end date. Set active=false to pause it, or endDate to finish it while keeping its history. ${SCHEDULE_HELP} ${BOUNDARY}`,
    { id: z.string().describe("Medication id from list_medications."), ...medicationPatchSchema.shape },
    async ({ id, ...patch }) => safely(() => updateMedication(id, patch)),
  ),
  tool(
    "log_dose",
    `Records a dose the person reports: status 'tomada' (taken), 'omitida' (skipped) or 'pospuesta' (postponed). ` +
      `For a scheduled dose pass the slot's date and scheduledTime ('HH:MM' from the schedule); re-logging a slot overwrites it. ` +
      `For an as-needed or extra intake omit scheduledTime. 'tomada' takes one from stock. takenAt is epoch ms, default now. ${BOUNDARY}`,
    {
      medicationId: z.string(),
      date: dateSchema.optional().describe("Local date of the slot; default today."),
      scheduledTime: timeSchema.optional(),
      status: z.enum(["tomada", "omitida", "pospuesta"]),
      takenAt: z.number().int().positive().optional(),
    },
    async ({ date, ...rest }) => safely(() => logDose({ ...rest, date: date ?? localNow().date })),
  ),
  tool(
    "get_adherence",
    `Adherence as of now: per medication and overall, due vs taken doses and rate (0..1) for the last 7 and 30 days, current and best streak ` +
      `of days with every dose taken, a 30-day per-day series, and optionally the raw dose log. Use it to encourage and spot missed doses; ` +
      `as-needed meds never count against adherence. ${BOUNDARY}`,
    { includeLog: z.boolean().default(false).describe("Also return logged dose events for the last 30 days.") },
    async ({ includeLog }) =>
      safely(() => {
        const now = localNow();
        const report = adherence(now.date, now.time);
        if (!includeLog) return report;
        const from = report.days[0]?.date ?? now.date;
        return { ...report, log: dosesBetween(from, now.date) };
      }),
  ),
];

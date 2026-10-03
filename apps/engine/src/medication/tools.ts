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
  updateMedication,
} from "./store";

/** Said once in every tool so the model sees the boundary wherever it starts. */
const BOUNDARY =
  "Track it exactly as the person describes; never recommend starting, stopping or changing a medication or dose: interactions, side effects and dosing go to their doctor or pharmacist.";

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
  "schedule = which days + when. Days, one of: every day (days []); weekdays (days, ISO 1 = Monday … 7 = Sunday); interval { every, unit day|week, start (default startDate) }, weeks on `days` (default start's weekday); monthDay (the last day in shorter months). " +
  "When, combinable: times (local 'HH:MM'); windows for 'en la mañana/tarde/noche' (default 07–12, 12–19, 19–23); anyTime = one dose due all day, missed only after it, reminded at `reminder` (default 19:00, null none); " +
  "training = due when a workout ends, within withinMinutes, and at restDayTime on days without training (null = not then); meals (at that meal's planned time); bedtime (30 min before sleep). " +
  "Never invent a clock time: use anyTime or a window. E.g. creatine after training, 09:00 on rest days = { training: { restDayTime: '09:00' } }; 'semaglutida los jueves, cuando sea' = { days: [4], anyTime: true }; 'vitamina D cada 2 semanas el domingo en la mañana' = { days: [7], interval: { every: 2, unit: 'week' }, windows: [{ part: 'manana' }] }. " +
  "Slot keys: 'HH:MM', or entreno (even on rest days), desayuno, comida, cena, dormir, manana, tarde, noche, dia (any time). Dates local 'YYYY-MM-DD'. stock = doses left (each 'tomada' uses one); lowStockThreshold warns at or below it.";

export const medicationTools = [
  tool(
    "list_medications",
    `Medications and supplements: dose (amount + unit), form, instructions, schedule, dates, stock, lowStock. ` +
      `With today's dose slots and status (pendiente/tomada/omitida/pospuesta): slot (its key), moment, time ('HH:MM' due, a window's start; null for any-time and while a workout is pending), window, training.state (trained/training/planned/rest). ${BOUNDARY}`,
    {
      includeInactive: z.boolean().default(false).describe("Also paused ones."),
      includeToday: z.boolean().default(true).describe("Today's slots and the next pending dose."),
    },
    async ({ includeInactive, includeToday }) =>
      safely(() => {
        const now = localNow();
        return { medications: listMedications({ includeInactive }), today: includeToday ? medicationDay(now.date, now.time) : undefined };
      }),
  ),
  tool(
    "add_medication",
    `Add a medication or supplement the person takes, as they describe it. kind 'suplemento' for creatine, protein, vitamins, omega 3, magnesium… (units like g, scoop, cápsula, gomita). ` +
      `Omitting schedule = as needed; ask when they take it if they didn't say. ${SCHEDULE_HELP} ${BOUNDARY}`,
    medicationInputSchema.shape,
    async (input) => safely(() => addMedication(input)),
  ),
  tool(
    "update_medication",
    `Change a medication by id, only the fields given: new times, a stock refill, instructions… active false pauses it; endDate finishes it, keeping its history. ` +
      `A schedule replaces the whole schedule, in add_medication's format. ${BOUNDARY}`,
    { id: z.string().describe("From list_medications."), ...medicationPatchSchema.shape },
    async ({ id, ...patch }) => safely(() => updateMedication(id, patch)),
  ),
  tool(
    "log_dose",
    `Record a dose the person reports: tomada (taken, uses one from stock), omitida (skipped) or pospuesta (postponed). ` +
      `A scheduled dose: its slot's date and scheduledTime = list_medications' today.slots[].slot; re-logging a slot overwrites it. As-needed or extra: omit scheduledTime. ${BOUNDARY}`,
    {
      medicationId: z.string(),
      date: dateSchema.optional().describe("Local date of the slot; default today."),
      scheduledTime: z.string().optional().describe("Slot key: 'HH:MM' or entreno/desayuno/comida/cena/dormir/manana/tarde/noche/dia."),
      status: z.enum(["tomada", "omitida", "pospuesta"]),
      takenAt: z.number().positive().optional().describe("Epoch ms; default now."),
    },
    async ({ date, ...rest }) => safely(() => logDose({ ...rest, date: date ?? localNow().date })),
  ),
  tool(
    "get_adherence",
    `Adherence as of now, per medication and overall: due vs taken and rate (0..1) over 7 and 30 days, current and best streak of full days, a 30-day daily series. ` +
      `Any-time and window doses count as missed only after their day; as-needed ones never count. ${BOUNDARY}`,
    { includeLog: z.boolean().default(false).describe("Also the dose log of the last 30 days.") },
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

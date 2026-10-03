import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { placementSchema, planTrainingWeek, replan, updatePlannedSession } from "./schedule";
import {
  addBusyBlock,
  addHealthEvent,
  busyInputSchema,
  dateSchema,
  deleteBusyBlock,
  getPreferences,
  healthInputSchema,
  healthPatchSchema,
  listBusyBlocks,
  listHealthEvents,
  mealTimesSchema,
  preferencesSchema,
  setMealTimesFor,
  setPreferences,
  updateBusyBlock,
  busyPatchSchema,
  updateHealthEvent,
} from "./store";
import { addDays, local } from "./time";
import { timeline } from "./timeline";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

async function safely(run: () => unknown) {
  try {
    return json(await run());
  } catch (error) {
    return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

const today = () => local().date;

const FORMATS = "Local dates 'YYYY-MM-DD', times 'HH:MM' 24 h, ISO weekdays (1 = Monday).";
const REPLAN =
  "Then upcoming planned sessions are re-checked: a clashing one moves to the nearest free slot (same day, then ±1–3 days), in `replan.moved`; one that can't move stays with a conflict in `replan.unresolved`.";
const HEALTH_BOUNDARY =
  "Record it in their words; never diagnose, name a likely condition or suggest treatment. Sharp, worsening or post-injury pain: tell them to see a professional.";
const AREAS = "bodyArea 'general' = the whole body (a cold, fever, surgery).";

export const calendarTools = [
  tool(
    "get_calendar",
    `The calendar for [from, to] (at most ~4 months): one timeline of planned and logged training (planned/moved/done/skipped/missed, conflicts), Health workouts, meals and meal times, medication doses, sleep, busy blocks, health events and body scans; ` +
      `plus busy block definitions (ids), active health events and scheduling preferences. ${FORMATS}`,
    {
      from: dateSchema.optional().describe("Default today."),
      to: dateSchema.optional().describe("Inclusive; default from + 6."),
    },
    async ({ from, to }) =>
      safely(() => {
        const start = from ?? today();
        const end = to ?? addDays(start, 6);
        return {
          ...timeline(start, end),
          busyBlocks: listBusyBlocks({ from: start, to: end }),
          activeHealthEvents: listHealthEvents({ activeOnly: true }),
          preferences: getPreferences(),
        };
      }),
  ),
  tool(
    "set_availability",
    `Save when they like to train and their day ("entreno por la tarde", "los domingos descanso"): trainingTimes (session starts, best first), sessionMinutes, restDays (weekdays never trained), wakeTime and sleepTime (sessions fit between), mealTimes (defaults). Only the fields given change. ${FORMATS} ${REPLAN}`,
    preferencesSchema.shape,
    async (prefs) => safely(() => ({ preferences: setPreferences(prefs), replan: replan() })),
  ),
  tool(
    "add_busy_block",
    `Record time they're busy and can't train (a meeting, shift, trip). One-off: date (to endDate for several days); weekly: weekdays (+ until). start and end for a timed block; neither (or allDay) for the whole day. ${FORMATS} ${REPLAN}`,
    { ...busyInputSchema.shape, source: z.literal("coach").default("coach") },
    async (input) => safely(() => ({ block: addBusyBlock(input), replan: replan() })),
  ),
  tool(
    "update_busy_block",
    `Change a busy block by id (get_calendar's busyBlocks), only the fields given. ${FORMATS} ${REPLAN}`,
    { id: z.string(), ...busyPatchSchema.omit({ source: true }).shape },
    async ({ id, ...patch }) => safely(() => ({ block: updateBusyBlock(id, patch), replan: replan() })),
  ),
  tool(
    "remove_busy_block",
    `Delete a busy block by id (get_calendar's busyBlocks). Sessions it moved stay where they are. ${REPLAN}`,
    { id: z.string() },
    async ({ id }) => safely(() => ({ removed: deleteBusyBlock(id), replan: replan() })),
  ),
  tool(
    "add_health_event",
    `Record an injury, illness, symptom or surgery, for the history and so training respects it. ${AREAS} severity 1 (mild) … 5 (severe) as they describe it. startDate when it began (ask or estimate); no endDate while ongoing. ` +
      `status defaults to activa (resuelta if it ended in the past). affectedTraining: how it limits training, their words ("nada de impacto"). ` +
      `An active illness or surgery of severity ≥ 3 takes training days off the plan; an active injury ≥ 4 keeps the days loading that area off; milder ones only warn. ` +
      `${HEALTH_BOUNDARY} ${FORMATS} ${REPLAN}`,
    healthInputSchema.shape,
    async (input) => safely(() => ({ event: addHealthEvent(input, today()), replan: replan() })),
  ),
  tool(
    "update_health_event",
    `Update a health event by id, only the fields given: severity, healing (recuperandose) or over (resuelta; without endDate it ends today). ${HEALTH_BOUNDARY} ${REPLAN}`,
    { id: z.string().describe("From list_health_events."), ...healthPatchSchema.shape },
    async ({ id, ...patch }) => safely(() => ({ event: updateHealthEvent(id, patch, today()), replan: replan() })),
  ),
  tool(
    "list_health_events",
    `Injuries, illnesses, symptoms and surgeries: active first, then history (newest first), with kind, bodyArea, severity 1–5, dates, status, notes, affectedTraining. ${HEALTH_BOUNDARY}`,
    {
      activeOnly: z.boolean().default(false).describe("Only unresolved ones."),
      from: dateSchema.optional().describe("Only events overlapping [from, to]."),
      to: dateSchema.optional(),
    },
    async (filter) => safely(() => listHealthEvents(filter)),
  ),
  tool(
    "plan_training_week",
    `Place the active program's days on the 7 days from \`from\` with start times, around busy blocks, rest days, sleep/wake times and active health events, replacing what was planned there from today on; days already done this ISO week are left out. ` +
      `Without placements it decides: pinned days stay on their weekday, the rest spread out avoiding back-to-back days; with them, clashes come back as warnings. ` +
      `Returns the sessions, the days it couldn't place and why, and warnings for injuries the plan touches (adapt those exercises). ${FORMATS}`,
    {
      from: dateSchema.optional().describe("Default today."),
      placements: z.array(placementSchema).max(14).optional().describe("Your own, by program day id."),
      reason: z.string().trim().max(300).optional().describe("One line, shown with each session."),
    },
    async (input) => safely(() => planTrainingWeek(input)),
  ),
  tool(
    "update_planned_session",
    `Move, re-time or skip one planned session by id (get_calendar items 'plan:<id>' or plan_training_week). A new date marks it moved. Add a short reason. ${FORMATS}`,
    {
      id: z.string(),
      date: dateSchema.optional(),
      time: z.string().optional(),
      durationMin: z.number().int().min(15).max(240).optional(),
      status: z.enum(["planned", "skipped"]).optional(),
      reason: z.string().max(300).optional(),
    },
    async ({ id, ...patch }) => safely(() => updatePlannedSession(id, patch)),
  ),
  tool(
    "set_meal_times",
    `Set meal times: the default for every day, or with dates an override for just those days (an empty list clears it). Fit them around training: a meal 2–3 h before a session, protein within a few hours after. ${FORMATS}`,
    {
      mealTimes: mealTimesSchema,
      dates: z.array(dateSchema).max(62).optional(),
    },
    async ({ mealTimes, dates }) =>
      safely(() => (dates?.length ? { byDate: setMealTimesFor(dates, mealTimes) } : { preferences: setPreferences({ mealTimes }) })),
  ),
];

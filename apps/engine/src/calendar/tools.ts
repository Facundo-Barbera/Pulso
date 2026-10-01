import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { placementSchema, planTrainingWeek, replan, updatePlannedSession } from "./schedule";
import {
  addBusyBlock,
  addHealthEvent,
  BODY_AREAS,
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

const FORMATS = "Dates are the person's local 'YYYY-MM-DD', times local 24h 'HH:MM', weekdays ISO (1 = Monday … 7 = Sunday).";
const REPLAN =
  "Afterwards every upcoming planned training session is re-checked: a clashing one moves to the nearest free slot (same day, then ±1–3 days) and comes back in `replan.moved`; " +
  "one that can't move (no room, or an injury) stays with a conflict in `replan.unresolved` — decide what to do and tell the person what changed.";
const HEALTH_BOUNDARY =
  "Record what the person reports in their words; never diagnose, name a likely condition, or suggest treatment. For pain that is sharp, worsening or follows an injury, tell them to see a professional.";
const AREAS = `bodyArea: a joint (knee, shoulder, ankle, wrist, elbow, hip), a muscle (${BODY_AREAS.slice(7).join(", ")}), or 'general' for the whole body (a cold, fever, surgery).`;

export const calendarTools = [
  tool(
    "get_calendar",
    `The person's calendar for [from, to] (at most ~4 months): one timeline merging planned and logged training (status planned/moved/done/skipped/missed, conflict text), ` +
      `Health workouts, meals and planned meal times, medication doses taken or skipped, sleep, busy blocks, health events and body scans. ` +
      `Also returns the busy block definitions (ids for update/remove), active health events and scheduling preferences. Read it before planning a week, ` +
      `when the person asks about their schedule, or to answer "when was I sick / what did I do around then". ${FORMATS}`,
    {
      from: dateSchema.optional().describe("First day; default today."),
      to: dateSchema.optional().describe("Last day, inclusive; default from + 6."),
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
    `Saves when the person likes to train and their day: trainingTimes (preferred session start times, best first), sessionMinutes (usual session length), ` +
      `restDays (weekdays they never train), wakeTime and sleepTime (sessions fit between them), mealTimes (default meal times, [{slot, time}], slot one of ` +
      `desayuno, media_manana, comida, merienda, cena, snack). Only the fields given change. Use it when they say things like "entreno por la tarde" or "los domingos descanso". ${FORMATS} ${REPLAN}`,
    preferencesSchema.shape,
    async (prefs) => safely(() => ({ preferences: setPreferences(prefs), replan: replan() })),
  ),
  tool(
    "add_busy_block",
    `Records time the person is busy and can't train: a meeting, work shift, trip, a family day. One-off: date (to endDate for several days, e.g. a trip). ` +
      `Weekly: weekdays + optional until. Give start and end for a timed block; omit both (or allDay true) for the whole day. ` +
      `Record it as soon as they mention being busy or travelling, then re-plan. ${FORMATS} ${REPLAN}`,
    { ...busyInputSchema.shape, source: z.literal("coach").default("coach") },
    async (input) => safely(() => ({ block: addBusyBlock(input), replan: replan() })),
  ),
  tool(
    "update_busy_block",
    `Changes a busy block by id (from get_calendar's busyBlocks): only the fields given. ${FORMATS} ${REPLAN}`,
    { id: z.string().describe("Busy block id."), ...busyPatchSchema.omit({ source: true }).shape },
    async ({ id, ...patch }) => safely(() => ({ block: updateBusyBlock(id, patch), replan: replan() })),
  ),
  tool(
    "remove_busy_block",
    `Deletes a busy block by id (from get_calendar's busyBlocks), e.g. a meeting that was cancelled. Sessions moved because of it stay where they are. ${REPLAN}`,
    { id: z.string() },
    async ({ id }) => safely(() => ({ removed: deleteBusyBlock(id), replan: replan() })),
  ),
  tool(
    "add_health_event",
    `Records an injury, illness, symptom or surgery the person mentions, so there is a history ("me enfermé por esas fechas") and training respects it. ` +
      `kind: lesion, enfermedad, sintoma, cirugia, otro. ${AREAS} severity 1 (mild) … 5 (severe), as the person describes it. ` +
      `startDate when it began (ask or estimate from what they say); endDate empty while ongoing. status: activa, recuperandose or resuelta (default activa, or resuelta if it ended in the past). ` +
      `affectedTraining: how it limits training in their words ("evitar sentadilla", "nada de impacto"). ` +
      `An active illness or surgery of severity ≥ 3 takes training days off the plan; an active injury of severity ≥ 4 keeps the program days that load that area off it; milder ones only warn. ` +
      `${HEALTH_BOUNDARY} ${FORMATS} ${REPLAN}`,
    healthInputSchema.shape,
    async (input) => safely(() => ({ event: addHealthEvent(input, today()), replan: replan() })),
  ),
  tool(
    "update_health_event",
    `Updates a health event by id (only the fields given): it got better or worse (severity), it is healing (status recuperandose) or over (status resuelta, endDate). ` +
      `Resolving without endDate ends it today. ${AREAS} ${HEALTH_BOUNDARY} ${REPLAN}`,
    { id: z.string().describe("Health event id from list_health_events."), ...healthPatchSchema.shape },
    async ({ id, ...patch }) => safely(() => ({ event: updateHealthEvent(id, patch, today()), replan: replan() })),
  ),
  tool(
    "list_health_events",
    `The person's injuries, illnesses, symptoms and surgeries: active first, then history (newest first), each with kind, bodyArea, severity 1–5, start/end dates, status, notes and affectedTraining. ` +
      `Check the active ones before prescribing or changing training, and say what you adapted because of them. Filter by dates to answer "what was going on around then". ${HEALTH_BOUNDARY}`,
    {
      activeOnly: z.boolean().default(false).describe("Only events not resolved yet."),
      from: dateSchema.optional().describe("Only events overlapping [from, to]."),
      to: dateSchema.optional(),
    },
    async (filter) => safely(() => listHealthEvents(filter)),
  ),
  tool(
    "plan_training_week",
    `Places the active program's days on the 7 days from \`from\` (default today) with a start time each, around busy blocks, rest days, sleep/wake times and active health events, ` +
      `replacing what was planned there from today on; program days already done this ISO week are left out. Without placements it decides itself: days pinned to a weekday stay there, ` +
      `the rest spread out avoiding back-to-back days. Pass placements [{dayId, date, time, durationMin?}] to choose yourself (clashes come back as warnings). ` +
      `Returns the planned sessions, the days it could not place and why, and warnings for injuries the plan touches — adapt or swap those exercises and tell the person. ` +
      `Use it after creating a program, when the person shares their week, or after their availability changes a lot. ${FORMATS}`,
    {
      from: dateSchema.optional().describe("First day of the 7-day window; default today."),
      placements: z.array(placementSchema).max(14).optional().describe("Your own placement, by program day id. Omit to let the planner decide."),
      reason: z.string().trim().max(300).optional().describe("One line on why this plan, shown with each session."),
    },
    async (input) => safely(() => planTrainingWeek(input)),
  ),
  tool(
    "update_planned_session",
    `Moves, re-times or skips one planned training session by id (from get_calendar items 'plan:<id>' or plan_training_week). status 'skipped' drops it for that day; ` +
      `a new date marks it moved. Add a short reason. ${FORMATS}`,
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
    `Sets meal times: [{slot, time}] with slot one of desayuno, media_manana, comida, merienda, cena, snack. Without dates they become the default for every day; ` +
      `with dates they override just those days (e.g. eat earlier on a day training at 19:00, or around a trip). Plan meals around training: ` +
      `a meal 2–3 h before a session and protein within a few hours after. An empty list on dates clears their override. ${FORMATS}`,
    {
      mealTimes: mealTimesSchema,
      dates: z.array(dateSchema).max(62).optional().describe("Only these days; omit for the default."),
    },
    async ({ mealTimes, dates }) =>
      safely(() => (dates?.length ? { byDate: setMealTimesFor(dates, mealTimes) } : { preferences: setPreferences({ mealTimes }) })),
  ),
];

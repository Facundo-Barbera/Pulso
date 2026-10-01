import type { CoachBriefKind } from "@pulso/contract";
import { addDays } from "./periods";

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]!;

const RULES = `
Rules for this brief:
- Nobody is chatting with you: this is not a conversation. Read with your pulso tools, then reply with ONLY the brief, in Spanish, ready to show on the person's phone. No greeting, no sign-off, no headings, no questions, no preamble about what you checked.
- Use only numbers you read in this turn. When a source has no data, leave it out; if almost nothing has data, say in one line which single thing to set up first (e.g. sincronizar Salud, poner objetivos de comida).
- Do not change anything: no logging, no plans, no profile edits.
- Markdown: one short line per item, each starting with a bold label.`.trim();

/** What the Coach is asked to write for one brief. `period` is the brief's date (the Sunday for weekly). */
export function briefPrompt(kind: CoachBriefKind, period: string): string {
  if (kind === "daily") {
    return [
      `Write the person's morning brief for today, ${weekday(period)} ${period}.`,
      "",
      "Read first: get_readiness (today), get_sleep_nights for last night (or get_sleep_summary), get_active_program (its nextDayId is today's training day; say which day and its focus, or that today is rest), get_targets and get_active_plan for today's eating, and list_medications for today's doses.",
      "",
      "Then write 3 to 5 lines covering readiness and sleep, today's training (adjusted to readiness: push, keep or go lighter), nutrition targets for today, and medication due today. The last line is the one most useful action for today.",
      "",
      RULES,
    ].join("\n");
  }
  const monday = addDays(period, -6);
  return [
    `Write the person's weekly check-in for the week from lunes ${monday} to domingo ${period}.`,
    "",
    `Read first: list_sessions and get_active_program (sessions done vs days in the program), list_meals from ${monday} to ${period} and get_targets (days logged, average kcal and protein vs targets), get_adherence (medication), get_sleep_summary with days 7 and get_daily_metrics for the week (sleep and readiness trend), body_projection for weight (trend per week and the goal ETA if there is a goal).`,
    "",
    "Then write 5 to 7 lines: training adherence, nutrition adherence, medication adherence, sleep and recovery trend, body trend and projection, and a last line labelled **Ajuste para la semana** with ONE concrete change for next week, grounded in the numbers above.",
    "",
    RULES,
  ].join("\n");
}

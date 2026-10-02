import { getProfile } from "../agent/profile";
import { createThread, getThread } from "../agent/threads";
import { describeLive, getLive, liveByThread, setLiveThread } from "./live";
import { trainingSettings } from "./store";

/**
 * The Coach inside a workout: the same runner and threads, one thread per
 * session, with a short prompt and only the tools a gym-floor change needs,
 * so a turn answers in seconds.
 */

export const LIVE_PERSONA = `
You are Pulso's Coach, talking to the person in the middle of a gym session, from their phone, between sets.
- Reply in Spanish, in their register, in ONE or TWO short lines. No headings, no lists unless they ask.
- Act, don't ask: when they want a change (another exercise, the machine is taken, something hurts, easier, harder, finish early), make it right away with edit_live_session and say in one line what you did. The app shows the change with an undo button.
- Changes in a session are for today only. Change the program itself (edit_program_day, swap_program_exercise with scope "always") only when they say so ("para siempre", "en el programa", "a partir de ahora").
- Swaps keep the same muscle target: pick with find_similar_exercises (it ranks their preferred equipment first; they usually prefer machines) and keep sets and reps.
- "Más fácil": less load (about 10%) or one set fewer; "más difícil": more load or one more set. "Me molesta algo": swap to a variant that spares the area and suggest stopping if it's sharp pain; never diagnose. "Terminar antes" in the middle of a cardio block (its timer is running, see "en marcha" below): finish_cardio on it, which keeps the minutes done; skip the exercises after it only if they say they're leaving; then tell them to tap Terminar. Never use skip to stop a running cardio. "Terminar antes" otherwise: skip what's left and tell them to tap Terminar.
- "Bajé a 60 para terminar 3 más" (they lowered the load mid-set to finish it): edit_live_session op drop on the set they just did, weightKg 60, reps 3. Don't change the next sets' load unless they ask.
- Exercise refs: "current" is the one on screen, or its position (1-based) from the session below.
`.trim();

const EQUIPMENT_ES: Record<string, string> = { machine: "máquinas", cable: "poleas", dumbbell: "mancuernas", barbell: "barra", bodyweight: "peso corporal", band: "bandas", kettlebell: "kettlebell" };

/** Tools the in-workout Coach gets (names without the `mcp__pulso__` prefix). */
export const LIVE_TOOLS = [
  "get_live_session",
  "edit_live_session",
  "find_similar_exercises",
  "list_exercises",
  "get_training_preferences",
  "set_training_preferences",
  "edit_program_day",
  "swap_program_exercise",
  "update_profile",
];

/** The thread bound to the session in progress, created with a title like "Entreno · Torso A · 1 oct". */
export function liveCoachThread(now = new Date()): string | undefined {
  const session = getLive();
  if (!session) return undefined;
  if (session.threadId && getThread(session.threadId)) return session.threadId;
  const day = new Date(session.startedAt).toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "");
  const thread = createThread(`Entreno · ${session.name} · ${day}`);
  setLiveThread(session.id, thread.id);
  return thread.id;
}

/** For a thread bound to the session in progress: its prompt, context and tools. Otherwise undefined. */
export function liveCoachMode(threadId: string, now = Date.now()): { persona: string; context: string; tools: string[] } | undefined {
  const session = liveByThread(threadId);
  if (!session) return undefined;
  const preferred = trainingSettings().preferredEquipment.map((e) => EQUIPMENT_ES[e] ?? e);
  const injuries = getProfile().injuries;
  const context = [
    "## The session right now (get_live_session has the live version)",
    describeLive(session, now),
    "",
    `Preferred equipment: ${preferred.length ? preferred.join(", ") : "none stated"}.`,
    injuries ? `Injuries and limits: ${injuries}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { persona: LIVE_PERSONA, context, tools: LIVE_TOOLS };
}

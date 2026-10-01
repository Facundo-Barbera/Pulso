import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Profile } from "@pulso/contract";

/**
 * Appended to Claude Code's system prompt for every Coach turn. Stable text, so
 * it caches; per-person facts go in the workspace CLAUDE.md instead.
 */
export const PERSONA = `
# You are Pulso's Coach

You are the personal health coach inside Pulso, an app that holds one person's training, diet and body-composition data. You talk to that one person, from their iPhone. You are not a coding assistant here: ignore software-engineering habits and never talk about files, code or tools by name.

## Voice
- Always reply in Spanish, matching the person's own register and dialect. Warm but direct: say what you think and why, without padding or cheerleading.
- Short paragraphs, phone-sized. Use Markdown lists and **bold** where they help scanning; use tables only for routines or meal plans. No headings bigger than ###.

## How you coach
- Evidence-based training and nutrition: progressive overload, adequate protein, energy balance, sleep, consistency over perfection. When the evidence is weak or mixed, say so.
- Before designing a routine or a diet, read the person's profile and their recent data with your pulso tools. If something that changes the plan is missing (goal, days available, equipment, injuries, allergies), ask for it — at most two or three questions at a time — instead of guessing.
- Whenever the person tells you something durable about themselves, save it with update_profile without asking. Do not announce routine saves.
- Use the data tools to ground what you say in their actual numbers. Never invent data you have not read.
- Web search is for checking a specific fact or guideline, not for padding answers.
- Plans must be concrete: exercises with sets × reps and rest, or meals with portions and approximate macros.

## Safety
- You are not a doctor and this is not medical advice; say so briefly when it matters, not in every message.
- Red flags — chest pain or pressure, fainting, shortness of breath out of proportion to effort, palpitations, sudden severe headache, numbness, signs of an eating disorder, rapid unexplained weight loss, pregnancy complications, or pain that is sharp, worsening or follows an injury: stop coaching around it, tell the person plainly to see a professional (urgently if acute), and do not prescribe through it.
- No extreme deficits, crash diets, or supplement and drug advice beyond well-established basics (creatine, caffeine, vitamin D when deficient, protein powder).
`.trim();

const ROOT = path.join(os.tmpdir(), "pulso-agent");

/** The thread's scratch directory. Ephemeral: it may vanish at any time; SQLite is the durable state. */
export function workspaceDir(threadId: string): string {
  return path.join(ROOT, threadId);
}

const FIELDS: [keyof Profile, string][] = [
  ["age", "Edad"],
  ["sex", "Sexo"],
  ["heightCm", "Altura (cm)"],
  ["goals", "Objetivos"],
  ["experience", "Experiencia"],
  ["equipment", "Equipamiento"],
  ["schedule", "Disponibilidad"],
  ["injuries", "Lesiones"],
  ["allergies", "Alergias"],
  ["foodPreferences", "Preferencias de comida"],
  ["notes", "Notas"],
];

export function claudeMd(profile: Profile, now = new Date()): string {
  const known = FIELDS.filter(([key]) => profile[key] !== undefined).map(([key, label]) => `- ${label}: ${String(profile[key])}`);
  return [
    "# Pulso Coach",
    "",
    "This directory is your private scratchpad for this conversation. You may keep notes here, but it can be wiped at any time: anything the person should keep belongs in their profile (update_profile) or their Pulso data.",
    "",
    `Today is ${now.toISOString().slice(0, 10)}.`,
    "",
    "## Profile snapshot (from when this turn started; get_profile has the live version)",
    known.length ? known.join("\n") : "- Nothing known yet. Learn the basics as the conversation goes and save them.",
    "",
  ].join("\n");
}

/** Creates the directory if it vanished and refreshes its CLAUDE.md. Returns the path. */
export function prepareWorkspace(threadId: string, profile: Profile): string {
  const dir = workspaceDir(threadId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), claudeMd(profile));
  return dir;
}

export function removeWorkspace(threadId: string): void {
  fs.rmSync(workspaceDir(threadId), { recursive: true, force: true });
}

/** True when `file` (absolute, or relative to `dir`) is inside `dir`. */
export function insideWorkspace(dir: string, file: string): boolean {
  const real = fs.realpathSync(dir);
  const target = path.resolve(dir, file);
  return [dir, real].some((root) => target === root || target.startsWith(root + path.sep));
}

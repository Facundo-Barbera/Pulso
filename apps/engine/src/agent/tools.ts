import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getProfile, profileShape, updateProfile } from "./profile";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

// Every field nullable so the model can clear one with null.
const patchShape = Object.fromEntries(Object.entries(profileShape).map(([key, schema]) => [key, schema.nullable().optional()])) as {
  [K in keyof typeof profileShape]: z.ZodOptional<z.ZodNullable<(typeof profileShape)[K]>>;
};

export const profileTools = [
  tool(
    "get_profile",
    "The person's stored profile: age, sex, heightCm, goals, experience, equipment, schedule, injuries, allergies, foodPreferences, notes. Missing fields are unknown. Read it before designing a routine or diet.",
    {},
    async () => json(getProfile()),
  ),
  tool(
    "update_profile",
    "Save what you learn about the person so future conversations remember it. Pass only the fields that changed; the rest are kept. Pass null to clear a field. Text fields replace the old value, so include what should stay. Use it whenever the person tells you something durable (a goal, an injury, their schedule, a food they avoid).",
    patchShape,
    async (patch) => json(updateProfile(patch)),
  ),
];

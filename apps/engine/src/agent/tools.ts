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
    "The person's long-term memory: the profile is all a new conversation knows about them. Call it in the same turn, without asking, whenever they mention something durable — a goal or deadline (goals), an injury, pain or condition (injuries), days and time available (schedule), equipment, training history (experience), allergies, foods they like or avoid (foodPreferences), how they like to be coached or anything else lasting (notes). Pass only the fields that changed; the rest are kept. Text fields replace the old value, so merge in what should stay. Pass null to clear a field. Not for one-off facts (today's meal, today's mood). Returns the saved profile.",
    patchShape,
    async (patch) => json(updateProfile(patch)),
  ),
];

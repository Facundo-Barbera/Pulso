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
    "The stored profile (age, sex, heightCm, goals, experience, equipment, schedule, injuries, allergies, foodPreferences, notes); missing fields are unknown.",
    {},
    async () => json(getProfile()),
  ),
  tool(
    "update_profile",
    "Save durable facts about the person (the profile is all a new conversation knows), in the same turn, without asking. Only the fields that changed; text replaces the old value, so merge in what should stay; null clears. Not for one-off facts. Returns the saved profile.",
    patchShape,
    async (patch) => json(updateProfile(patch)),
  ),
];

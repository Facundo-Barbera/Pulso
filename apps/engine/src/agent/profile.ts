import type { Profile } from "@pulso/contract";
import { z } from "zod";
import { db } from "../db";

/** Field-by-field schema, shared by the agent tool and the store's validation. */
export const profileShape = {
  age: z.number().int().min(10).max(110).describe("Age in years"),
  sex: z.enum(["male", "female", "other"]),
  heightCm: z.number().min(100).max(250).describe("Height in centimeters"),
  goals: z.string().max(2000).describe("What they want to achieve, in their words"),
  experience: z.string().max(2000).describe("Training history and level"),
  equipment: z.string().max(2000).describe("Gym, home equipment, nothing…"),
  schedule: z.string().max(2000).describe("Days and times available to train, how long per session"),
  injuries: z.string().max(2000).describe("Injuries, pain, conditions that limit training"),
  allergies: z.string().max(2000).describe("Food allergies and intolerances"),
  foodPreferences: z.string().max(2000).describe("Diet style, foods they like or avoid, cooking habits"),
  notes: z.string().max(4000).describe("Anything else worth remembering about the person"),
};

const profileSchema = z.object(profileShape).partial();

export function getProfile(): Profile {
  const row = db().query<{ data: string }, []>("SELECT data FROM agent_profile WHERE id = 1").get();
  return row ? (JSON.parse(row.data) as Profile) : {};
}

/** Merges `patch` into the profile. A `null` field clears it. Returns the new profile. */
export function updateProfile(patch: { [K in keyof Profile]?: Profile[K] | null }): Profile {
  const next: Record<string, unknown> = { ...getProfile() };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in profileShape) || value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  const profile = profileSchema.parse(next) as Profile;
  db()
    .query("INSERT INTO agent_profile (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .run(JSON.stringify(profile), Date.now());
  return profile;
}

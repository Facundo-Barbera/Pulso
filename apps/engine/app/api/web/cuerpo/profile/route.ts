import { z } from "zod";
import { profileShape, updateProfile } from "@/src/agent/profile";
import { json } from "../../http";
import { invalid } from "../issues";

export const dynamic = "force-dynamic";

/** The profile fields Cuerpo edits. `null` clears one; fields left out stay as they are. */
const patchSchema = z
  .object({
    age: profileShape.age.nullable(),
    sex: profileShape.sex.nullable(),
    heightCm: profileShape.heightCm.nullable(),
    goals: profileShape.goals.nullable(),
    experience: profileShape.experience.nullable(),
  })
  .partial()
  .strict();

/** Merges the patch into the profile the Coach also reads → the new `Profile`. */
export async function PATCH(request: Request): Promise<Response> {
  const parsed = patchSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return invalid(parsed.error);
  return json(updateProfile(parsed.data));
}

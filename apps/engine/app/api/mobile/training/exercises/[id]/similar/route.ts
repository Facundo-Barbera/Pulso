import type { Equipment } from "@pulso/contract";
import { equipmentEnum } from "@/src/training/inputs";
import { exercisesWithMedia } from "@/src/training/media";
import { similarExercises } from "@/src/training/similar";
import { deviceOf, NO_STORE, unpaired } from "../../../../auth";

export const dynamic = "force-dynamic";

/** `?equipment=machine,cable&limit=20` → `{ exercises: SimilarExercise[] }`, best first. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const query = new URL(request.url).searchParams;
  const equipment = (query.get("equipment") ?? "").split(",").filter((e): e is Equipment => equipmentEnum.safeParse(e).success);
  const limit = Math.min(Math.max(Number(query.get("limit")) || 20, 1), 50);
  const list = similarExercises((await params).id, { equipment, limit });
  if (!list) return Response.json({ code: "not_found", message: "No existe ese ejercicio." }, { status: 404, headers: NO_STORE });
  const media = exercisesWithMedia(list);
  return Response.json({ exercises: list.map((e, i) => ({ ...e, ...media[i] })) }, { headers: NO_STORE });
}

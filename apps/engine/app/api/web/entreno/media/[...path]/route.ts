import { firstFrame, loadGif, MEDIA_HEADERS, mediaSourceOf, parseMediaPath } from "@/src/training/media";
import { json } from "../../../http";

export const dynamic = "force-dynamic";

/**
 * `exercises/<id>/animation.gif` or `thumbnail.gif`, streamed from ExerciseDB
 * through the engine like the phone's route: their terms forbid storing it,
 * so it lives in memory for an hour at most and the browser's cache is capped the same.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const target = parseMediaPath((await params).path);
  const sourceId = target && mediaSourceOf(target.exerciseId);
  if (!target || !sourceId) return json({ code: "not_found", message: "No hay animación para ese ejercicio." }, 404);
  const gif = await loadGif(sourceId);
  if (!gif) return json({ code: "unavailable", message: "ExerciseDB no respondió; prueba en un rato." }, 502);
  return new Response(target.kind === "thumbnail" ? (firstFrame(gif) ?? gif) : gif, { headers: MEDIA_HEADERS });
}

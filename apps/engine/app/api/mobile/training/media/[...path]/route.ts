import { firstFrame, loadGif, MEDIA_HEADERS, mediaSourceOf, parseMediaPath } from "@/src/training/media";
import { deviceOf, NO_STORE, unpaired } from "../../../auth";

export const dynamic = "force-dynamic";

const notFound = () => Response.json({ code: "not_found", message: "No hay animación para ese ejercicio." }, { status: 404, headers: NO_STORE });

/**
 * `exercises/<id>/animation.gif` or `thumbnail.gif`, streamed from ExerciseDB
 * through the engine (their terms forbid storing it; memory holds it an hour).
 */
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const target = parseMediaPath((await params).path);
  const sourceId = target && mediaSourceOf(target.exerciseId);
  if (!target || !sourceId) return notFound();
  const gif = await loadGif(sourceId);
  if (!gif) return Response.json({ code: "unavailable", message: "ExerciseDB no respondió; prueba en un rato." }, { status: 502, headers: NO_STORE });
  const bytes = target.kind === "thumbnail" ? (firstFrame(gif) ?? gif) : gif;
  return new Response(bytes, { headers: MEDIA_HEADERS });
}

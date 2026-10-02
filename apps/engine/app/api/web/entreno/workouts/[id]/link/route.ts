import { z } from "zod";
import { LinkError, linkWorkout, unlinkWorkout } from "@/src/workouts-merge";
import { json } from "../../../../http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const body = z.object({ sessionId: z.string().nullable() });

const failed = (error: unknown) => {
  if (!(error instanceof LinkError)) throw error;
  return json({ code: error.code, message: error.code === "not_found" ? "Ya no existe ese entrenamiento o sesión." : "Esta es la copia que Pulso guardó en Salud." }, error.code === "not_found" ? 404 : 400);
};

/** "Unir con…" (`{ sessionId }`) or "Separar" (`{ sessionId: null }`) a Health workout. Returns `{ session }`, merged. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return json({ code: "invalid_request", message: "expected { sessionId: string | null }" }, 400);
  try {
    return json({ session: linkWorkout((await params).id, parsed.data.sessionId) });
  } catch (error) {
    return failed(error);
  }
}

/** Back to matching by time. */
export async function DELETE(_request: Request, { params }: Context): Promise<Response> {
  try {
    return json({ session: unlinkWorkout((await params).id) });
  } catch (error) {
    return failed(error);
  }
}

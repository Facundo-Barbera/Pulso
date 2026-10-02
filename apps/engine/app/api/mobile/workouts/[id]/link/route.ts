import { LinkError, linkWorkout, unlinkWorkout } from "@/src/workouts-merge";
import { deviceOf, NO_STORE, unpaired } from "../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const failed = (error: unknown) => {
  if (!(error instanceof LinkError)) throw error;
  return Response.json({ code: error.code, message: error.message }, { status: error.code === "not_found" ? 404 : 400, headers: NO_STORE });
};

/** `WorkoutLinkInput`: join the workout to a session, or `{ sessionId: null }` to keep it apart. Returns `{ session }`, merged. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const body = (await request.json().catch(() => undefined)) as { sessionId?: unknown } | undefined;
  if (!body || !(body.sessionId === null || typeof body.sessionId === "string")) {
    return Response.json({ code: "invalid_request", message: "expected { sessionId: string | null }" }, { status: 400, headers: NO_STORE });
  }
  try {
    return Response.json({ session: linkWorkout((await params).id, body.sessionId) }, { headers: NO_STORE });
  } catch (error) {
    return failed(error);
  }
}

/** Back to matching by time. Returns `{ session }`. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  try {
    return Response.json({ session: unlinkWorkout((await params).id) }, { headers: NO_STORE });
  } catch (error) {
    return failed(error);
  }
}

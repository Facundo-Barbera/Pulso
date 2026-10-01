import { getSession } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../../auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** One logged session (`TrainingSession`): a week's done day opens it. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const session = getSession((await params).id);
  if (!session) return Response.json({ code: "not_found", message: "no such session" }, { status: 404, headers: NO_STORE });
  return Response.json(session, { headers: NO_STORE });
}

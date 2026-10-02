import { setVisibleOn } from "@/src/substances/store";
import { webKey } from "@/src/substances/web";
import { json } from "../../http";
import { body } from "../respond";

export const dynamic = "force-dynamic";

/** Body: `{ visible: boolean }` → `{ visible }` for the browser asking (or this Mac). Each browser decides for itself. */
export async function PUT(request: Request): Promise<Response> {
  const key = webKey(request.headers);
  if (!key) return json({ code: "unpaired", message: "Este navegador no está emparejado." }, 401);
  const input = (await body(request)) as { visible?: unknown } | undefined;
  if (typeof input?.visible !== "boolean") return json({ code: "invalid_request", message: "visible es true o false." }, 400);
  return json({ visible: setVisibleOn(key, input.visible) });
}

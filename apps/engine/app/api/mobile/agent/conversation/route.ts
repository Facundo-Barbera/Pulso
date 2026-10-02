import { conversationView, pageParams } from "@/src/agent/feed";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

/** The Coach's one conversation: the latest page (`?before=<cursor>` for older ones, `?limit=`), its contexts, and whether a turn is running. */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  return Response.json(conversationView(...pageParams(request)), { headers: NO_STORE });
}

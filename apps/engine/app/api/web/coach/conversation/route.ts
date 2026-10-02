import { conversationView, pageParams } from "@/src/agent/feed";
import { json } from "../../http";

export const dynamic = "force-dynamic";

/** The Coach's one conversation: the latest page (`?before=<cursor>` for older ones, `?limit=`), its contexts, and whether a turn is running. */
export function GET(request: Request): Response {
  return json(conversationView(...pageParams(request)));
}

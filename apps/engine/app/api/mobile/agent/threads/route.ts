import { createThread, listThreads } from "@/src/agent/threads";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  return Response.json({ threads: listThreads() }, { headers: NO_STORE });
}

/** Starts an empty thread. It is titled from its first message. */
export function POST(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  return Response.json({ thread: createThread() }, { status: 201, headers: NO_STORE });
}

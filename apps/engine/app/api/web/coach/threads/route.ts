import { createThread, listThreads } from "@/src/agent/threads";
import { json } from "../../http";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return json({ threads: listThreads() });
}

/** Starts an empty thread. It is titled from its first message. */
export function POST(): Response {
  return json({ thread: createThread() }, 201);
}

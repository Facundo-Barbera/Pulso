import { dataDir } from "@/src/db";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

/** Loopback only: the desktop runner and curl use it to tell the engine is up. */
export function GET(): Response {
  return Response.json({ ok: true, pid: process.pid, dataDir: dataDir(), startedAt }, { headers: { "cache-control": "no-store" } });
}

import { deviceOf, NO_STORE, unpaired } from "../auth";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const device = deviceOf(request);
  if (!device) return unpaired();
  return Response.json({ at: Date.now(), device }, { headers: NO_STORE });
}

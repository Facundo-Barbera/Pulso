import { getProfile } from "@/src/agent/profile";
import { bodyAnalysis } from "@/src/body/standards";
import { listGoals, listScans, projections } from "@/src/body/store";
import { deviceOf, NO_STORE, unpaired } from "../auth";

export const dynamic = "force-dynamic";

/** Everything the Cuerpo tab draws: scans (newest first, without raw payloads), goals, the four projections and the InBody-style analysis. */
export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  const scans = listScans(200).map((scan) => ({ ...scan, raw: null }));
  return Response.json({ scans, goals: listGoals(), projections: projections(), analysis: bodyAnalysis(scans, getProfile()) }, { headers: NO_STORE });
}

import { listWorkouts, parseWorkoutInputs, upsertHealthKitWorkouts } from "@/src/workouts";
import { deviceOf, NO_STORE, unpaired } from "../auth";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  return Response.json({ workouts: listWorkouts() }, { headers: NO_STORE });
}

/** HealthKit sync: `{ workouts: WorkoutInput[] }`, upserted by HealthKit UUID. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const inputs = parseWorkoutInputs(await request.json().catch(() => undefined));
  if (!inputs) return Response.json({ code: "invalid_request", message: "expected { workouts: WorkoutInput[] }" }, { status: 400 });
  return Response.json({ written: upsertHealthKitWorkouts(inputs) }, { headers: NO_STORE });
}

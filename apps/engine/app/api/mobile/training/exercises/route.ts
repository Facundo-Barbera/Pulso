import { listExercises } from "@/src/training/store";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  return Response.json({ exercises: listExercises() }, { headers: NO_STORE });
}

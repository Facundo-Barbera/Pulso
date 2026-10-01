import { addMedication, listMedications } from "@/src/medication/store";
import { deviceOf, unpaired } from "../auth";
import { body, respond } from "./respond";

export const dynamic = "force-dynamic";

/** `?all=1` includes paused medications. */
export function GET(request: Request): Promise<Response> {
  if (!deviceOf(request)) return Promise.resolve(unpaired());
  const includeInactive = new URL(request.url).searchParams.get("all") === "1";
  return respond(() => ({ medications: listMedications({ includeInactive }) }));
}

/** Body: `MedicationInput`. Returns the created `Medication`. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request);
  return respond(() => addMedication(input));
}

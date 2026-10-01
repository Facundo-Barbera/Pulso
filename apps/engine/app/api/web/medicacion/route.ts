import { addMedication } from "@/src/medication/store";
import { medicationPage } from "@/src/web/medication";
import { json } from "../http";
import { body, respond } from "./respond";

export const dynamic = "force-dynamic";

/** `MedicationPage`: everything the Medicación page draws. */
export function GET(): Response {
  return json(medicationPage());
}

/** Body: `MedicationInput` → the new `Medication`. */
export async function POST(request: Request): Promise<Response> {
  const input = await body(request);
  return respond(() => addMedication(input));
}

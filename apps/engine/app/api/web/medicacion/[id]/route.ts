import { deleteMedication, updateMedication } from "@/src/medication/store";
import { body, respond, type IdContext } from "../respond";

export const dynamic = "force-dynamic";

/** Body: `MedicationPatch` → the updated `Medication`. */
export async function PATCH(request: Request, { params }: IdContext): Promise<Response> {
  const { id } = await params;
  const patch = await body(request);
  return respond(() => updateMedication(id, patch));
}

/** Deletes the medication and its dose history. */
export async function DELETE(_request: Request, { params }: IdContext): Promise<Response> {
  const { id } = await params;
  return respond(() => {
    deleteMedication(id);
    return { deleted: id };
  });
}

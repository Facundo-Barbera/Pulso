import { deleteMedication, updateMedication } from "@/src/medication/store";
import { deviceOf, unpaired } from "../../auth";
import { body, respond } from "../respond";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Body: `MedicationPatch`. Returns the updated `Medication`. */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  const patch = await body(request);
  return respond(() => updateMedication(id, patch));
}

/** Deletes the medication and its dose history. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const { id } = await params;
  return respond(() => {
    deleteMedication(id);
    return { deleted: id };
  });
}

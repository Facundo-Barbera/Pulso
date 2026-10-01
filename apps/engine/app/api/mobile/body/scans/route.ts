import { addScan, scanInputSchema } from "@/src/body/store";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

/** Save one scan (manual entry, or a parsed QR the person confirmed). Same `externalId` replaces. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const parsed = scanInputSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".") || "scan"}: ${i.message}`).join("; ");
    return Response.json({ code: "invalid_request", message }, { status: 400 });
  }
  return Response.json({ scan: addScan(parsed.data) }, { headers: NO_STORE });
}

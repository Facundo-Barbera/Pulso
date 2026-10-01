import { addScan, scanInputSchema } from "@/src/body/store";
import { json } from "../../http";
import { invalid } from "../issues";

export const dynamic = "force-dynamic";

/** Saves one scan: a manual entry, or a parsed QR the person confirmed. Same `externalId` replaces. */
export async function POST(request: Request): Promise<Response> {
  const parsed = scanInputSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return invalid(parsed.error);
  return json({ scan: addScan(parsed.data) }, 201);
}

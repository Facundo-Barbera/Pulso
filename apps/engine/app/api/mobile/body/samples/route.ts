import { samplesSchema, upsertSamples } from "@/src/body/store";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

/** HealthKit sync: `{ samples: BodySample[] }` (weight kg, body fat %), upserted by HealthKit UUID. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const parsed = samplesSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ code: "invalid_request", message: "expected { samples: BodySample[] }" }, { status: 400 });
  return Response.json({ written: upsertSamples(parsed.data.samples) }, { headers: NO_STORE });
}

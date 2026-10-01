import { readInBodyQr } from "@/src/body/store";
import { deviceOf, NO_STORE, unpaired } from "../../auth";

export const dynamic = "force-dynamic";

/**
 * `{ payload }` (the QR text) → the parsed scan, NOT saved: the phone shows it
 * for confirmation and then POSTs it to /body/scans. Unreadable payloads are
 * stored raw and answered 422 with `unknown_inbody_format` or `unmapped_ibdata`.
 */
export async function POST(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const payload = ((await request.json().catch(() => undefined)) as { payload?: unknown })?.payload;
  if (typeof payload !== "string" || !payload.trim() || payload.length > 8000) {
    return Response.json({ code: "invalid_request", message: "expected { payload: string }" }, { status: 400 });
  }
  const result = readInBodyQr(payload);
  if (!result.ok) return Response.json(result, { status: 422, headers: NO_STORE });
  return Response.json(result, { headers: NO_STORE });
}

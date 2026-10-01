import { readInBodyQr } from "@/src/body/store";
import { json } from "../../http";

export const dynamic = "force-dynamic";

/**
 * `{ payload }` (the QR text) → `InBodyParse`, NOT saved: the page shows the
 * values for confirmation and then POSTs them to /cuerpo/scans. Unreadable
 * payloads are kept raw for a later parser and answered 422.
 */
export async function POST(request: Request): Promise<Response> {
  const payload = ((await request.json().catch(() => undefined)) as { payload?: unknown } | undefined)?.payload;
  if (typeof payload !== "string" || !payload.trim() || payload.length > 8000) return json({ code: "invalid_request", message: "Esperaba el texto del QR." }, 400);
  const result = readInBodyQr(payload);
  return json(result, result.ok ? 200 : 422);
}

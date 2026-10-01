import type { BodyImport } from "@pulso/contract";
import { parseInBodyCsv } from "@/src/body/inbody-csv";
import { addScans } from "@/src/body/store";
import { json } from "../../http";

export const dynamic = "force-dynamic";

/** An InBody CSV export as the raw body. Rows dedupe by test time, so importing the same file twice is harmless. */
export async function POST(request: Request): Promise<Response> {
  const csv = await request.text();
  if (!csv.trim() || csv.length > 5_000_000) return json({ code: "invalid_request", message: "Esperaba el texto de un CSV." }, 400);
  const { scans, skipped } = parseInBodyCsv(csv);
  if (!scans.length) return json({ code: "unreadable_csv", message: "No encontré mediciones en ese CSV. ¿Es una exportación de InBody?", skipped }, 422);
  const result: BodyImport = { imported: addScans(scans), skipped };
  return json(result);
}

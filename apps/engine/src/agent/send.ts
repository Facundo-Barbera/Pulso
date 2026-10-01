import { MAX_AGENT_ATTACHMENTS, MAX_AGENT_PRODUCTS, type AgentProduct } from "@pulso/contract";
import { lookupBarcode, normalizeBarcode } from "../nutrition/barcode";
import { AttachmentError, discardImages, saveImages } from "./attachments";
import { activeTurn, startTurn, type QueryFn } from "./runner";

export const MAX_TEXT = 8000;

export type SendResult = ReturnType<typeof startTurn> | { status: 400 | 409; code: "invalid_request" | "busy"; message: string };

const invalid = (message: string): SendResult => ({ status: 400, code: "invalid_request", message });
const busy = (): SendResult => ({ status: 409, code: "busy", message: "El Coach todavía está respondiendo en esta conversación." });

/** Each scanned code with its product, looked up now (the scan already cached it). Unknown or unreachable → null. */
async function resolveProducts(codes: string[]): Promise<AgentProduct[]> {
  return Promise.all(codes.map(async (barcode) => ({ barcode, product: await lookupBarcode(barcode).catch(() => null) })));
}

/**
 * A message as the phone or the browser sends it: JSON `{ text, barcodes? }`,
 * or multipart/form-data with `text`, up to MAX_AGENT_ATTACHMENTS `image`
 * files and up to MAX_AGENT_PRODUCTS `barcode` fields. Photos are saved in the
 * thread's folder, products are looked up, and the turn starts with them.
 */
export async function sendMessage(threadId: string, request: Request, run?: QueryFn): Promise<SendResult> {
  let text = "";
  let files: File[] = [];
  let raw: unknown[] = [];
  if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const form = await request.formData().catch(() => undefined);
    if (!form) return invalid("No pude leer el mensaje.");
    const field = form.get("text");
    text = typeof field === "string" ? field.trim() : "";
    files = form.getAll("image").filter((f): f is File => typeof f !== "string");
    raw = form.getAll("barcode");
  } else {
    const body = (await request.json().catch(() => undefined)) as { text?: unknown; barcodes?: unknown } | undefined;
    text = typeof body?.text === "string" ? body.text.trim() : "";
    raw = Array.isArray(body?.barcodes) ? body.barcodes : [];
  }
  if (files.length > MAX_AGENT_ATTACHMENTS) return invalid(`Puedes mandar hasta ${MAX_AGENT_ATTACHMENTS} fotos por mensaje.`);
  if (raw.length > MAX_AGENT_PRODUCTS) return invalid(`Puedes mandar hasta ${MAX_AGENT_PRODUCTS} productos por mensaje.`);
  const codes = raw.map((c) => (typeof c === "string" ? normalizeBarcode(c) : undefined));
  if (codes.some((c) => !c)) return invalid("Un código de barras no es válido: debe tener de 8 a 14 dígitos.");
  if ((!text && !files.length && !codes.length) || text.length > MAX_TEXT) return invalid(`El mensaje debe tener entre 1 y ${MAX_TEXT} caracteres.`);
  if (activeTurn(threadId)) return busy();

  const products = await resolveProducts(codes as string[]);
  let attachments;
  try {
    attachments = await saveImages(threadId, await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer()))));
  } catch (error) {
    if (error instanceof AttachmentError) return invalid(error.message);
    throw error;
  }
  try {
    return startTurn(threadId, text, run, attachments, products);
  } catch {
    // Another turn started while the photos were converting.
    discardImages(threadId, attachments);
    return busy();
  }
}

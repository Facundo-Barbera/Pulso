import { MAX_AGENT_ATTACHMENTS } from "@pulso/contract";
import { AttachmentError, discardImages, saveImages } from "./attachments";
import { activeTurn, startTurn, type QueryFn } from "./runner";

export const MAX_TEXT = 8000;

export type SendResult = ReturnType<typeof startTurn> | { status: 400 | 409; code: "invalid_request" | "busy"; message: string };

const invalid = (message: string): SendResult => ({ status: 400, code: "invalid_request", message });
const busy = (): SendResult => ({ status: 409, code: "busy", message: "El Coach todavía está respondiendo en esta conversación." });

/**
 * A message as the phone or the browser sends it: JSON `{ text }`, or
 * multipart/form-data with `text` and up to MAX_AGENT_ATTACHMENTS `image`
 * files. Photos are saved in the thread's folder and the turn starts with them.
 */
export async function sendMessage(threadId: string, request: Request, run?: QueryFn): Promise<SendResult> {
  let text = "";
  let files: File[] = [];
  if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const form = await request.formData().catch(() => undefined);
    if (!form) return invalid("No pude leer el mensaje.");
    const field = form.get("text");
    text = typeof field === "string" ? field.trim() : "";
    files = form.getAll("image").filter((f): f is File => typeof f !== "string");
  } else {
    const body = (await request.json().catch(() => undefined)) as { text?: unknown } | undefined;
    text = typeof body?.text === "string" ? body.text.trim() : "";
  }
  if (files.length > MAX_AGENT_ATTACHMENTS) return invalid(`Puedes mandar hasta ${MAX_AGENT_ATTACHMENTS} fotos por mensaje.`);
  if ((!text && !files.length) || text.length > MAX_TEXT) return invalid(`El mensaje debe tener entre 1 y ${MAX_TEXT} caracteres.`);
  if (activeTurn(threadId)) return busy();

  let attachments;
  try {
    attachments = await saveImages(threadId, await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer()))));
  } catch (error) {
    if (error instanceof AttachmentError) return invalid(error.message);
    throw error;
  }
  try {
    return startTurn(threadId, text, run, attachments);
  } catch {
    // Another turn started while the photos were converting.
    discardImages(threadId, attachments);
    return busy();
  }
}

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentAttachment } from "@pulso/contract";
import { dataDir } from "../db";
import { hasAttachment } from "./threads";

/** Long edge of a stored photo, px: enough to read a nutrition label; the model scales anything bigger down anyway. */
export const LONG_EDGE = 1600;
/** What one photo may weigh as sent (a full-size HEIC or PNG screenshot), before conversion. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** What one photo may weigh once converted. */
export const MAX_STORED_BYTES = 8 * 1024 * 1024;

/** A photo that can't be used; the message is in Spanish, for the person. */
export class AttachmentError extends Error {}

const run = promisify(execFile);
const ID = /^[0-9a-f-]{36}$/;

/** Photos stay on this Mac, in one folder per thread under the data dir. Durable, unlike the thread's workspace. */
export function attachmentsDir(threadId: string): string {
  return path.join(dataDir(), "attachments", threadId);
}

export function attachmentPath(threadId: string, id: string): string {
  if (!ID.test(threadId) || !ID.test(id)) throw new AttachmentError("Foto desconocida.");
  return path.join(attachmentsDir(threadId), `${id}.jpg`);
}

export function removeAttachments(threadId: string): void {
  fs.rmSync(attachmentsDir(threadId), { recursive: true, force: true });
}

/** The format by its bytes, never by the name or type the client gave. */
export function sniffImage(bytes: Uint8Array): "jpeg" | "png" | "heic" | undefined {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  // ISO BMFF: a `ftyp` box with a HEIF brand (what an iPhone camera writes).
  if (ascii(4, 8) === "ftyp" && ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(ascii(8, 12))) return "heic";
  return undefined;
}

async function dimensions(file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const width = Number(/pixelWidth: (\d+)/.exec(stdout)?.[1]);
  const height = Number(/pixelHeight: (\d+)/.exec(stdout)?.[1]);
  if (!width || !height) throw new AttachmentError("No pude leer una de las fotos.");
  return { width, height };
}

/** One photo as a JPEG at `out`, at most LONG_EDGE px on its long edge (never upscaled), converted with the Mac's sips. */
async function toJpeg(input: string, out: string): Promise<{ width: number; height: number }> {
  const { width, height } = await dimensions(input);
  const resize = Math.max(width, height) > LONG_EDGE ? ["-Z", String(LONG_EDGE)] : [];
  await run("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "82", ...resize, input, "--out", out]);
  if (fs.statSync(out).size > MAX_STORED_BYTES) throw new AttachmentError("Una de las fotos es demasiado grande.");
  return dimensions(out);
}

/**
 * Saves a message's photos in the thread's folder, as JPEGs. All or nothing:
 * when one can't be used, none stays on disk and AttachmentError says why.
 */
export async function saveImages(threadId: string, images: Uint8Array[]): Promise<AgentAttachment[]> {
  if (!images.length) return [];
  const dir = attachmentsDir(threadId);
  fs.mkdirSync(dir, { recursive: true });
  const saved: AgentAttachment[] = [];
  try {
    for (const bytes of images) {
      if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new AttachmentError("Una de las fotos es demasiado grande.");
      const kind = sniffImage(bytes);
      if (!kind) throw new AttachmentError("Solo puedo ver fotos JPEG, PNG o HEIC.");
      const id = randomUUID();
      const input = path.join(dir, `${id}.upload.${kind}`);
      fs.writeFileSync(input, bytes);
      try {
        saved.push({ id, mime: "image/jpeg", ...(await toJpeg(input, attachmentPath(threadId, id))) });
      } catch (error) {
        fs.rmSync(attachmentPath(threadId, id), { force: true });
        throw error instanceof AttachmentError ? error : new AttachmentError("No pude leer una de las fotos.");
      } finally {
        fs.rmSync(input, { force: true });
      }
    }
  } catch (error) {
    discardImages(threadId, saved);
    throw error;
  }
  return saved;
}

/** Removes photos that never made it into a message. */
export function discardImages(threadId: string, attachments: AgentAttachment[]): void {
  for (const a of attachments) fs.rmSync(attachmentPath(threadId, a.id), { force: true });
}

/** The photo as base64, for an image content block. */
export function readImageBase64(threadId: string, id: string): string {
  return fs.readFileSync(attachmentPath(threadId, id)).toString("base64");
}

/** The photo as an HTTP response, or undefined when this thread has no such photo. Ids never change, so it caches for good. */
export function attachmentResponse(threadId: string, id: string): Response | undefined {
  if (!ID.test(threadId) || !ID.test(id) || !hasAttachment(threadId, id)) return undefined;
  const file = attachmentPath(threadId, id);
  if (!fs.existsSync(file)) return undefined;
  return new Response(fs.readFileSync(file), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
}

import { MAX_AGENT_ATTACHMENTS, type AgentAttachment } from "@pulso/contract";
import { uuid } from "../../../_ui/insecure";

export const MAX_PHOTOS = MAX_AGENT_ATTACHMENTS;
/** Same as the Mac keeps: enough to read a label, and a small upload. */
const LONG_EDGE = 1600;

/** A photo picked in the composer, ready to send. `url` previews it until the Mac has its own copy. */
export type Photo = { id: string; blob: Blob; url: string; width: number; height: number };

/**
 * Downscaled and re-encoded as JPEG in the browser (upright: `createImageBitmap`
 * applies the EXIF orientation). A format the browser can't draw (HEIC outside
 * Safari) goes as it is; the Mac converts it.
 */
export async function preparePhoto(file: File): Promise<Photo> {
  const id = `local-${uuid()}`;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("encode");
    return { id, blob, url: URL.createObjectURL(blob), width, height };
  } catch {
    return { id, blob: file, url: URL.createObjectURL(file), width: 0, height: 0 };
  }
}

/** Image files among what was dropped, pasted or picked. */
export const imageFiles = (files: FileList | File[] | null | undefined): File[] => [...(files ?? [])].filter((f) => f.type.startsWith("image/") || /\.hei[cf]$/i.test(f.name));

// Previews of photos this browser just sent, until a reload brings the Mac's ids.
const localUrls = new Map<string, string>();

export function rememberLocal(photos: Photo[]): AgentAttachment[] {
  for (const p of photos) localUrls.set(p.id, p.url);
  return photos.map((p) => ({ id: p.id, mime: "image/jpeg", width: p.width, height: p.height }));
}

export function photoSrc(threadId: string, attachment: AgentAttachment): string {
  return localUrls.get(attachment.id) ?? `/api/web/coach/threads/${threadId}/attachments/${attachment.id}`;
}

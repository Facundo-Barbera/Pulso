import { beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { GET as mobilePhotoGET } from "@/app/api/mobile/agent/threads/[id]/attachments/[attachmentId]/route";
import { POST as mobilePOST } from "@/app/api/mobile/agent/threads/[id]/messages/route";
import { DELETE as webThreadDELETE } from "@/app/api/web/coach/threads/[id]/route";
import { POST as webPOST } from "@/app/api/web/coach/threads/[id]/messages/route";
import { dataDir } from "../db";
import { createPairingCode, redeemPairing } from "../devices";
import { attachmentPath, attachmentResponse, attachmentsDir, saveImages, sniffImage } from "./attachments";
import { recapPrompt, type QueryFn } from "./runner";
import { sendMessage } from "./send";
import { createThread, getMessage, getThread, listMessages } from "./threads";

/** A real PNG, solid colour, built by hand so the test needs no fixture. */
function png(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    out.set(data, 8);
    out.writeUInt32BE(Bun.hash.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "binary"), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", new Uint8Array())]);
}

const SESSION = "22222222-2222-2222-2222-222222222222";
const done = [
  { type: "system", subtype: "init", session_id: SESSION, parent_tool_use_id: null },
  { type: "result", subtype: "success", is_error: false, result: "", session_id: SESSION, parent_tool_use_id: null },
] as unknown as SDKMessage[];

/** Records what the SDK would have been sent, draining a streamed prompt like the SDK does. */
function recordingQuery(sent: (string | SDKUserMessage[])[]): QueryFn {
  return (({ prompt }: { prompt: string | AsyncIterable<SDKUserMessage>; options: Options }) =>
    (async function* () {
      if (typeof prompt === "string") sent.push(prompt);
      else {
        const messages: SDKUserMessage[] = [];
        for await (const m of prompt) messages.push(m);
        sent.push(messages);
      }
      yield* done;
    })()) as unknown as QueryFn;
}

function form(text: string, images: Uint8Array[]): Request {
  const body = new FormData();
  body.set("text", text);
  images.forEach((bytes, i) => body.append("image", new Blob([new Uint8Array(bytes)], { type: "image/png" }), `p${i}.png`));
  return new Request("http://pulso.test/x", { method: "POST", body });
}

let token = "";
beforeAll(() => {
  token = redeemPairing({ code: createPairingCode().code, name: "Test" }).token;
});

test("formats are told by their bytes", () => {
  expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
  expect(sniffImage(png(1, 1))).toBe("png");
  expect(sniffImage(new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypheic")]))).toBe("heic");
  expect(sniffImage(Buffer.from("GIF89a......"))).toBeUndefined();
  expect(sniffImage(Buffer.from("<svg></svg>"))).toBeUndefined();
});

test("photos are stored as JPEGs in the thread's folder, the long edge cut to 1600 px and never upscaled", async () => {
  const thread = createThread();
  const [big, small] = await saveImages(thread.id, [png(3200, 1000), png(400, 300)]);
  expect(big).toMatchObject({ mime: "image/jpeg", width: 1600, height: 500 });
  expect(small).toMatchObject({ width: 400, height: 300 });
  const file = attachmentPath(thread.id, big!.id);
  expect(file).toBe(path.join(dataDir(), "attachments", thread.id, `${big!.id}.jpg`));
  expect(sniffImage(new Uint8Array(fs.readFileSync(file)))).toBe("jpeg");
  // Only the converted JPEGs stay: no uploads left behind.
  expect(fs.readdirSync(attachmentsDir(thread.id)).sort()).toEqual([`${big!.id}.jpg`, `${small!.id}.jpg`].sort());
});

test("one bad file keeps the whole message's photos off disk", async () => {
  const thread = createThread();
  await expect(saveImages(thread.id, [png(10, 10), Buffer.from("not an image")])).rejects.toThrow("JPEG, PNG o HEIC");
  expect(fs.readdirSync(attachmentsDir(thread.id))).toEqual([]);
});

test("a message with photos is saved with them and sent to the model as image blocks, then the text", async () => {
  const thread = createThread();
  const sent: (string | SDKUserMessage[])[] = [];
  const result = await sendMessage(thread.id, form("Registra esto", [png(20, 10), png(10, 20)]), recordingQuery(sent));
  if (!("turn" in result)) throw new Error(result.message);
  await result.done;

  const [user] = listMessages(thread.id);
  expect(user).toMatchObject({ role: "user", text: "Registra esto" });
  expect(user!.attachments.map((a) => [a.width, a.height])).toEqual([[20, 10], [10, 20]]);
  expect(getMessage(user!.id)!.attachments).toEqual(user!.attachments);

  const [messages] = sent as SDKUserMessage[][];
  expect(messages).toHaveLength(1);
  const content = messages![0]!.message.content as { type: string; source?: { type: string; media_type: string; data: string }; text?: string }[];
  expect(content.map((b) => b.type)).toEqual(["image", "image", "text"]);
  expect(content[0]!.source).toMatchObject({ type: "base64", media_type: "image/jpeg" });
  expect(Buffer.from(content[0]!.source!.data, "base64").equals(fs.readFileSync(attachmentPath(thread.id, user!.attachments[0]!.id)))).toBe(true);
  expect(content[2]!.text).toBe("Registra esto");
});

test("photos alone are a message: no text block, and the thread is titled from them", async () => {
  const thread = createThread();
  const sent: (string | SDKUserMessage[])[] = [];
  const result = await sendMessage(thread.id, form("", [png(8, 8)]), recordingQuery(sent));
  if (!("turn" in result)) throw new Error(result.message);
  await result.done;
  const content = (sent[0] as SDKUserMessage[])[0]!.message.content as { type: string }[];
  expect(content.map((b) => b.type)).toEqual(["image"]);
  expect(getThread(thread.id)!.title).toBe("Foto");
});

test("text without photos still goes as a plain prompt", async () => {
  const thread = createThread();
  const sent: (string | SDKUserMessage[])[] = [];
  const result = await sendMessage(thread.id, new Request("http://pulso.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hola" }) }), recordingQuery(sent));
  if ("done" in result) await result.done;
  expect(sent).toEqual(["hola"]);
});

test("a recap marks the photos a message carried", () => {
  const photo = { id: "a", mime: "image/jpeg" as const, width: 1, height: 1 };
  const base = { threadId: "t", tools: [], products: [], status: "done" as const, error: null, createdAt: 0 };
  const recap = recapPrompt(
    [
      { ...base, id: "1", role: "user", text: "", attachments: [photo, photo] },
      { ...base, id: "2", role: "assistant", text: "Registrado.", attachments: [] },
    ],
    "¿Y ahora?",
  );
  expect(recap).toContain("Persona: [2 fotos] \n");
  expect(recap).toContain("Coach: Registrado.");
});

test("the routes refuse too many photos, an empty message, and files that aren't photos", async () => {
  const thread = createThread();
  const id = { params: Promise.resolve({ id: thread.id }) };
  const five = form("hola", Array.from({ length: 5 }, () => png(4, 4)));
  const tooMany = await webPOST(five, id);
  expect(tooMany.status).toBe(400);
  expect(((await tooMany.json()) as { message: string }).message).toContain("hasta 4 fotos");
  expect((await webPOST(form("", []), id)).status).toBe(400);
  const notPhoto = new FormData();
  notPhoto.append("image", new Blob(["%PDF-1.7"], { type: "image/jpeg" }), "x.jpg");
  expect((await webPOST(new Request("http://pulso.test/x", { method: "POST", body: notPhoto }), id)).status).toBe(400);
  // The phone needs its token.
  expect((await mobilePOST(form("hola", [png(4, 4)]), id)).status).toBe(401);
  expect(listMessages(thread.id)).toEqual([]);
});

test("a photo is served only within its own thread, and goes with the thread", async () => {
  const thread = createThread();
  const other = createThread();
  const result = await sendMessage(thread.id, form("mira", [png(6, 6)]), recordingQuery([]));
  if ("done" in result) await result.done;
  const photo = listMessages(thread.id)[0]!.attachments[0]!;
  const ctx = (threadId: string, attachmentId: string) => ({ params: Promise.resolve({ id: threadId, attachmentId }) });
  const authed = new Request("http://pulso.test/x", { headers: { authorization: `Bearer ${token}` } });

  const ok = await mobilePhotoGET(authed, ctx(thread.id, photo.id));
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toBe("image/jpeg");
  expect((await mobilePhotoGET(new Request("http://pulso.test/x"), ctx(thread.id, photo.id))).status).toBe(401);
  expect((await mobilePhotoGET(authed, ctx(other.id, photo.id))).status).toBe(404);
  expect(attachmentResponse(thread.id, "../../pulso.sqlite")).toBeUndefined();

  expect((await webThreadDELETE(new Request("http://pulso.test/x", { method: "DELETE" }), { params: Promise.resolve({ id: thread.id }) })).status).toBe(204);
  expect(fs.existsSync(attachmentsDir(thread.id))).toBe(false);
});

import { expect, test } from "bun:test";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { FoodProduct } from "@pulso/contract";
import { POST as webPOST } from "@/app/api/web/coach/threads/[id]/messages/route";
import { db } from "../db";
import { recapPrompt, type QueryFn } from "./runner";
import { sendMessage } from "./send";
import { createThread, getMessage, getThread, listMessages } from "./threads";

const SESSION = "33333333-3333-3333-3333-333333333333";
const done = [
  { type: "system", subtype: "init", session_id: SESSION, parent_tool_use_id: null },
  { type: "result", subtype: "success", is_error: false, result: "", session_id: SESSION, parent_tool_use_id: null },
] as unknown as SDKMessage[];

function recordingQuery(sent: unknown[]): QueryFn {
  return (({ prompt }: { prompt: unknown; options: Options }) =>
    (async function* () {
      sent.push(prompt);
      yield* done;
    })()) as unknown as QueryFn;
}

const jar: FoodProduct = {
  barcode: "8480000123456",
  name: "Crema de cacahuete",
  brand: "Hacendado",
  per100g: { kcal: 588, protein: 25, carbs: 12, fat: 49, fiber: 6 },
  servingGrams: 15,
  imageUrl: null,
  liquid: false,
  packageSize: 350,
  packageKind: null,
};
db().query("INSERT OR REPLACE INTO food_barcode_cache (barcode, product_json, fetched_at) VALUES (?, ?, ?)").run(jar.barcode, JSON.stringify(jar), Date.now());

const post = (body: unknown) => new Request("http://pulso.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("a scanned product is stored with the message and reaches the model as label facts before the words", async () => {
  const thread = createThread();
  const sent: unknown[] = [];
  const result = await sendMessage(thread.id, post({ text: "me comí una cucharada", barcodes: [jar.barcode] }), recordingQuery(sent));
  if (!("turn" in result)) throw new Error(result.message);
  await result.done;

  const [user] = listMessages(thread.id);
  expect(user!.products).toEqual([{ barcode: jar.barcode, product: jar }]);
  expect(getMessage(user!.id)!.products).toEqual(user!.products);

  const prompt = sent[0] as string;
  expect(prompt).toContain("<scanned_product>\nBarcode: 8480000123456\nName: Crema de cacahuete — brand: Hacendado");
  expect(prompt).toContain("Per 100 g: 588 kcal, protein 25 g");
  expect(prompt).toContain("Package: 350 g");
  expect(prompt).toContain("estimate_portion");
  expect(prompt.endsWith("The person's message:\nme comí una cucharada")).toBe(true);
});

test("a scan alone is a message, titled by the product; multipart carries barcode fields", async () => {
  const thread = createThread();
  const sent: unknown[] = [];
  const body = new FormData();
  body.set("text", "");
  body.append("barcode", jar.barcode);
  const result = await sendMessage(thread.id, new Request("http://pulso.test/x", { method: "POST", body }), recordingQuery(sent));
  if (!("turn" in result)) throw new Error(result.message);
  await result.done;
  expect(getThread(thread.id)!.title).toBe("Crema de cacahuete");
  expect(sent[0] as string).toContain("sent only the scan");
});

test("bad or too many codes are refused before anything is stored", async () => {
  const thread = createThread();
  const id = { params: Promise.resolve({ id: thread.id }) };
  const bad = await webPOST(post({ text: "hola", barcodes: ["12ab"] }), id);
  expect(bad.status).toBe(400);
  expect(((await bad.json()) as { message: string }).message).toContain("código de barras");
  expect((await webPOST(post({ text: "hola", barcodes: Array(5).fill(jar.barcode) }), id)).status).toBe(400);
  expect(listMessages(thread.id)).toEqual([]);
});

test("a recap names the products a message carried", () => {
  const base = { threadId: "t", tools: [], attachments: [], status: "done" as const, error: null, createdAt: 0 };
  const recap = recapPrompt([{ ...base, id: "1", role: "user", text: "una cucharada", products: [{ barcode: jar.barcode, product: jar }] }], "¿y ahora?");
  expect(recap).toContain("Persona: [producto 8480000123456: Crema de cacahuete] una cucharada");
});

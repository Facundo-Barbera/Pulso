import { beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentConversation, AgentStreamEvent } from "@pulso/contract";
import { GET as mobileFeedGET } from "@/app/api/mobile/agent/conversation/route";
import { POST as mobileNewContext } from "@/app/api/mobile/agent/conversation/contexts/route";
import { POST as mobileSwitch } from "@/app/api/mobile/agent/conversation/contexts/[id]/route";
import { GET as webFeedGET } from "@/app/api/web/coach/conversation/route";
import { db, dataDir } from "../db";
import { createPairingCode, redeemPairing } from "../devices";
import { ownDatabase } from "../web/test-db";
import { activeContext, contextMessages, ensureConversation, feedPage, getContext, listContexts, newContext, PRUNE_AFTER_MS, quoteMessage, switchContext } from "./conversation";
import { conversationView, sendToConversation } from "./feed";
import { eventStream } from "./ndjson";
import { agentOptions, AUTO_COMPACT_WINDOW, startTurn, subscribe, type QueryFn } from "./runner";
import { addMessage, createThread, listMessages, setSdkSession } from "./threads";
import { PHOTO_PLACEHOLDER, sdkConfigDir, stripImages, transcriptExists } from "./transcripts";
import { COMPACT_PROMPT, compactActive, distillOnce, pruneTranscripts } from "./upkeep";

ownDatabase("conversation");

const S1 = "11111111-1111-1111-1111-111111111111";
const S2 = "22222222-2222-2222-2222-222222222222";

const m = (session: string, message: object) => ({ session_id: session, parent_tool_use_id: null, ...message }) as unknown as SDKMessage;
const reply = (session: string, text: string, extra: SDKMessage[] = []): SDKMessage[] => [
  m(session, { type: "system", subtype: "init" }),
  ...extra,
  m(session, { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } }),
  m(session, { type: "result", subtype: "success", is_error: false, result: text }),
];

type Call = { prompt: unknown; options: Options };

function fakeQuery(scripts: SDKMessage[][], calls: Call[] = []): QueryFn {
  return (({ prompt, options }: Call) => {
    calls.push({ prompt, options });
    const script = scripts[calls.length - 1] ?? [];
    return (async function* () {
      for (const message of script) {
        await Bun.sleep(1);
        yield message;
      }
    })();
  }) as unknown as QueryFn;
}

async function turn(text: string, run: QueryFn): Promise<AgentStreamEvent[]> {
  const { turn, done } = startTurn(ensureConversation().thread_id, text, run);
  const events = (await new Response(eventStream((emit) => subscribe(turn, emit))).text()).trimEnd().split("\n").map((l) => JSON.parse(l) as AgentStreamEvent);
  await done;
  return events;
}

/** A transcript where the CLI would write it, with one photo. */
function writeTranscript(session: string, mtime?: number): string {
  const dir = path.join(sdkConfigDir(), "projects", "-pulso-coach");
  fs.mkdirSync(path.join(dir, session), { recursive: true });
  const file = path.join(dir, `${session}.jsonl`);
  const photo = { type: "user", message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } }, { type: "text", text: "mira" }] } };
  fs.writeFileSync(file, [JSON.stringify({ type: "summary" }), JSON.stringify(photo), JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Veo arroz." }] } })].join("\n"));
  if (mtime) fs.utimesSync(file, mtime / 1000, mtime / 1000);
  return file;
}

let token = "";
const authed = (url = "http://pulso.test/x", method = "GET") => new Request(url, { method, headers: { authorization: `Bearer ${token}` } });

beforeAll(() => {
  token = redeemPairing({ code: createPairingCode().code, name: "Test" }).token;
  // Before the conversation exists: two old chats and a live-workout one.
  const plan = createThread();
  addMessage(plan.id, "user", "Quiero bajar 5 kg antes de junio.", "done");
  addMessage(plan.id, "assistant", "Hagamos un déficit suave de 300 kcal.", "done");
  const empty = createThread();
  addMessage(empty.id, "assistant", "", "error");
  const gym = createThread("Entreno · Torso A · 1 oct");
  addMessage(gym.id, "user", "La máquina está ocupada", "done");
});

test("the first run moves to one conversation, seeded from the old chats but not showing them", () => {
  const threadsBefore = db().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM agent_threads").get()!.n;
  const conversation = ensureConversation();
  const context = activeContext();
  expect(context.seed).toContain("Quiero bajar 5 kg antes de junio.");
  expect(context.seed).not.toContain("máquina está ocupada");
  expect(conversation.distilled_at).toBeNull();

  // Idempotent: the same conversation, one context, the old threads kept.
  expect(ensureConversation().thread_id).toBe(conversation.thread_id);
  expect(listContexts()).toHaveLength(1);
  expect(db().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM agent_threads").get()!.n).toBe(threadsBefore + 1);

  const view = conversationView();
  expect(view.items).toEqual([{ type: "marker", marker: expect.objectContaining({ kind: "distilled", contextId: context.id }) }]);
});

test("the distillation runs once: the model's summary replaces the trimmed recap", async () => {
  const calls: Call[] = [];
  const run = fakeQuery([reply("x", "### Sobre la persona\n- Quiere bajar 5 kg antes de junio.")], calls);
  await distillOnce(run);
  await distillOnce(run);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.prompt as string).toContain("Hagamos un déficit suave");
  expect(calls[0]!.options).toMatchObject({ persistSession: false, maxTurns: 1, tools: [] });
  expect(activeContext().seed).toBe("### Sobre la persona\n- Quiere bajar 5 kg antes de junio.");
  expect(ensureConversation().distilled_at).not.toBeNull();
});

test("the first turn starts from the seed; the next one resumes the context's session", async () => {
  const calls: Call[] = [];
  const run = fakeQuery([reply(S1, "Hola de nuevo."), reply(S1, "Sigamos.")], calls);
  await turn("Hola", run);
  expect(calls[0]!.options.resume).toBeUndefined();
  expect(calls[0]!.prompt as string).toContain("<earlier_conversations>");
  expect(calls[0]!.prompt as string).toContain("Quiere bajar 5 kg");
  expect(activeContext().sdk_session_id).toBe(S1);
  // One shared workspace for the conversation, transcripts in the data dir, compaction at 200k.
  expect(calls[0]!.options.cwd).toBe(path.join(dataDir(), "coach"));
  expect(calls[0]!.options.env?.CLAUDE_CONFIG_DIR).toBe(sdkConfigDir());
  expect(calls[0]!.options.settings).toMatchObject({ autoCompactEnabled: true, autoCompactWindow: AUTO_COMPACT_WINDOW });

  await turn("¿Y mañana?", run);
  expect(calls[1]!.options.resume).toBe(S1);
  expect(calls[1]!.prompt).toBe("¿Y mañana?");
  expect(contextMessages(activeContext().id).map((m) => m.text)).toEqual(["Hola", "Hola de nuevo.", "¿Y mañana?", "Sigamos."]);
});

test("a brief quoted into the conversation goes with the next message, once", async () => {
  const quoted = quoteMessage({ kind: "brief", title: "Resumen del 2 oct" }, "Hoy: pierna.");
  expect(quoteMessage({ kind: "brief", title: "Resumen del 2 oct" }, "Hoy: pierna.").id).toBe(quoted.id);
  const calls: Call[] = [];
  await turn("Dale", fakeQuery([reply(S1, "Vamos.")], calls));
  expect(calls[0]!.prompt as string).toContain('<brief title="Resumen del 2 oct">\nHoy: pierna.\n</brief>');
  expect(calls[0]!.prompt as string).toContain("Dale");
});

test("the SDK's own compaction leaves a quiet marker before the message that triggered it", async () => {
  const compacting = [
    m(S1, { type: "system", subtype: "status", status: "compacting" }),
    m(S1, { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 190_000 } }),
    m(S1, { type: "system", subtype: "status", status: null }),
  ];
  const events = await turn("Otra cosa", fakeQuery([reply(S1, "Claro.", compacting)]));
  expect(events.filter((e) => e.type === "status" || e.type === "compacted")).toEqual([{ type: "status", status: "compacting" }, { type: "compacted" }, { type: "status", status: null }]);
  expect(activeContext().compacted_at).not.toBeNull();
  const items = feedPage().items;
  const marker = items.findIndex((i) => i.type === "marker" && i.marker.kind === "compacted");
  const asked = items.findIndex((i) => i.type === "message" && i.message.text === "Otra cosa");
  expect(marker).toBe(asked - 1);
});

test("the hourly summary runs /compact on the active session only when there is something new", async () => {
  const calls: Call[] = [];
  const boundary = m(S1, { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 50_000 } });
  const run = fakeQuery([[boundary, m(S1, { type: "result", subtype: "success", is_error: false, result: "" })]], calls);
  // Nothing new since the auto compaction above.
  expect(await compactActive(run)).toBe(false);
  await Bun.sleep(2);
  addMessage(ensureConversation().thread_id, "user", "nota", "done");
  expect(await compactActive(run)).toBe(true);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.prompt).toBe(COMPACT_PROMPT);
  expect(calls[0]!.options.resume).toBe(S1);
  expect(await compactActive(run)).toBe(false);
  // One marker for back-to-back summaries with nothing between them.
  const kinds = feedPage().items.map((i) => (i.type === "marker" ? i.marker.kind : "message"));
  expect(kinds.at(-1)).toBe("compacted");
  expect(kinds.filter((k) => k === "compacted")).toHaveLength(2);
});

test("the hourly summary waits for a turn in flight", async () => {
  await Bun.sleep(2);
  const calls: Call[] = [];
  const slow = (async function* () {})();
  const { done } = startTurn(ensureConversation().thread_id, "espera", (() => slow) as unknown as QueryFn);
  expect(await compactActive(fakeQuery([], calls))).toBe(false);
  expect(calls).toHaveLength(0);
  await done;
});

test("a new context starts a fresh session; going back resumes the old one", async () => {
  const first = activeContext();
  const fresh = newContext();
  expect(fresh.id).not.toBe(first.id);
  // An empty active context is kept: no pile of empty ones.
  expect(newContext().id).toBe(fresh.id);

  const calls: Call[] = [];
  await turn("Empecemos de cero", fakeQuery([reply(S2, "Listo.")], calls));
  expect(calls[0]!.options.resume).toBeUndefined();
  expect(calls[0]!.prompt).toBe("Empecemos de cero");
  expect(getContext(fresh.id)!.sdk_session_id).toBe(S2);

  switchContext(first.id);
  const back: Call[] = [];
  await turn("Volví", fakeQuery([reply(S1, "Bienvenido.")], back));
  expect(back[0]!.options.resume).toBe(S1);
  expect(contextMessages(first.id).at(-1)?.text).toBe("Bienvenido.");

  const kinds = feedPage().items.flatMap((i) => (i.type === "marker" ? [i.marker.kind] : []));
  expect(kinds.slice(-2)).toEqual(["context", "switch"]);
  expect(listContexts().map((c) => c.active)).toEqual([false, true]);
});

test("going back to a context whose transcript is gone rebuilds it from that context's messages", async () => {
  const back = activeContext();
  const other = listContexts().find((c) => !c.active)!;
  switchContext(other.id);
  db().query("UPDATE agent_contexts SET sdk_session_id = NULL WHERE id = ?").run(other.id);
  const calls: Call[] = [];
  await turn("¿Dónde estábamos?", fakeQuery([reply(S2, "En el plan.")], calls));
  expect(calls[0]!.options.resume).toBeUndefined();
  expect(calls[0]!.prompt as string).toContain("Persona: Empecemos de cero");
  expect(calls[0]!.prompt as string).not.toContain("earlier_conversations");
  switchContext(back.id);
});

test("photos leave the transcript after their turn; the files stay", () => {
  const file = writeTranscript(S1);
  expect(stripImages(S1)).toBe(1);
  const lines = fs.readFileSync(file, "utf8").split("\n").map((l) => JSON.parse(l));
  expect(lines[1].message.content).toEqual([{ type: "text", text: PHOTO_PLACEHOLDER }, { type: "text", text: "mira" }]);
  expect(lines[2].message.content[0].text).toBe("Veo arroz.");
  expect(stripImages(S1)).toBe(0);
});

test("transcripts of contexts untouched for a month are deleted; their messages stay", () => {
  const active = activeContext();
  const past = listContexts().find((c) => !c.active)!;
  writeTranscript(S2);
  db().query("UPDATE agent_contexts SET sdk_session_id = ? WHERE id = ?").run(S2, past.id);
  const count = contextMessages(past.id).length;
  expect(pruneTranscripts()).toBe(0);
  expect(pruneTranscripts(Date.now() + PRUNE_AFTER_MS + 60_000)).toBe(1);
  expect(transcriptExists(S2)).toBe(false);
  expect(getContext(past.id)).toMatchObject({ sdk_session_id: null, pruned_at: expect.any(Number) });
  expect(contextMessages(past.id)).toHaveLength(count);
  // The active context is never pruned.
  expect(getContext(active.id)!.sdk_session_id).toBe(S1);
});

test("the feed pages back with a cursor, markers on the page they belong to", () => {
  const all: string[] = [];
  let before: string | undefined;
  let markers = 0;
  for (let page = 0; page < 20; page++) {
    const result = feedPage(before, 3);
    all.unshift(...result.items.map((i) => (i.type === "message" ? i.message.id : `marker:${i.marker.id}`)));
    markers += result.items.filter((i) => i.type === "marker").length;
    if (!result.before) break;
    before = result.before;
  }
  const threadId = ensureConversation().thread_id;
  expect(all.filter((id) => !id.startsWith("marker:"))).toEqual(listMessages(threadId).map((m) => m.id));
  expect(markers).toBe(db().query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM agent_feed_markers WHERE thread_id = ?").get(threadId)!.n);
  expect(new Set(all).size).toBe(all.length);
});

test("sends wait for the hourly summary, then go into the active context", async () => {
  await Bun.sleep(2);
  const threadId = ensureConversation().thread_id;
  addMessage(threadId, "user", "algo nuevo", "done");
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const boundary = m(S1, { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 1 } });
  const slowCompact = (() =>
    (async function* () {
      await gate;
      yield boundary;
    })()) as unknown as QueryFn;
  const compaction = compactActive(slowCompact);
  expect(conversationView().compacting).toBe(true);
  const calls: Call[] = [];
  const sending = sendToConversation(new Request("http://pulso.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "¿Sigues?" }) }), fakeQuery([reply(S1, "Sí.")], calls));
  await Bun.sleep(5);
  expect(calls).toHaveLength(0);
  release();
  await compaction;
  const sent = await sending;
  if (!("turn" in sent)) throw new Error(sent.message);
  await sent.done;
  expect(calls).toHaveLength(1);
  expect(listMessages(threadId).at(-1)).toMatchObject({ text: "Sí.", contextId: activeContext().id });
});

test("the feed routes: the phone needs its token, contexts switch, the browser reads the same", async () => {
  expect((await mobileFeedGET(new Request("http://pulso.test/x"))).status).toBe(401);
  const feed = (await (await mobileFeedGET(authed("http://pulso.test/x?limit=2"))).json()) as AgentConversation;
  expect(feed.items.filter((i) => i.type === "message")).toHaveLength(2);
  expect(feed.before).toBeTruthy();
  const older = (await (await mobileFeedGET(authed(`http://pulso.test/x?limit=2&before=${feed.before}`))).json()) as AgentConversation;
  expect(older.items.length).toBeGreaterThan(0);

  const created = await mobileNewContext(authed("http://pulso.test/x", "POST"));
  expect(created.status).toBe(201);
  const after = (await created.json()) as AgentConversation;
  expect(after.activeContextId).not.toBe(feed.activeContextId);

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  expect((await mobileSwitch(authed("http://pulso.test/x", "POST"), ctx("nope"))).status).toBe(404);
  const back = (await (await mobileSwitch(authed("http://pulso.test/x", "POST"), ctx(feed.activeContextId))).json()) as AgentConversation;
  expect(back.activeContextId).toBe(feed.activeContextId);

  // Busy while a turn runs.
  const pending = (async function* () {
    await Bun.sleep(20);
  })();
  const { done } = startTurn(back.threadId, "espera", (() => pending) as unknown as QueryFn);
  expect((await mobileNewContext(authed("http://pulso.test/x", "POST"))).status).toBe(409);
  await done;

  const web = (await (await webFeedGET(new Request("http://pulso.test/x"))).json()) as AgentConversation;
  expect(web.threadId).toBe(back.threadId);
});

test("agent options keep compaction on even if the engine's env turned it off", () => {
  process.env.DISABLE_AUTO_COMPACT = "1";
  process.env.ANTHROPIC_API_KEY ??= "test";
  try {
    const options = agentOptions("/tmp", "", undefined, new AbortController());
    expect(options.env?.DISABLE_AUTO_COMPACT).toBeUndefined();
    expect(options.settings).toMatchObject({ autoCompactWindow: 200_000, cleanupPeriodDays: 3650 });
  } finally {
    delete process.env.DISABLE_AUTO_COMPACT;
  }
});

test("a live-workout thread keeps its own session and workspace", async () => {
  const gym = createThread("Entreno · Pierna · 2 oct");
  setSdkSession(gym.id, null);
  const calls: Call[] = [];
  const { done } = startTurn(gym.id, "Cambia el ejercicio", fakeQuery([reply(S2, "Hecho.")], calls));
  await done;
  expect(calls[0]!.options.cwd).toBe(path.join(dataDir(), "threads", gym.id));
  expect(listMessages(gym.id).every((m) => m.contextId === null)).toBe(true);
});

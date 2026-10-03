"use client";

import type { AgentContext, AgentConversation, AgentFeedItem, AgentMessage, AgentProduct, AgentUndoResponse } from "@pulso/contract";
import { useSyncExternalStore } from "react";
import { uuid } from "../../../_ui/insecure";
import { rememberLocal, type Photo } from "./photos";
import { applyEvent, mergeLatest, prependOlder, readEvents } from "./stream";

/**
 * The web Coach's client state, outside React like iOS's store: the one
 * conversation, so a reply keeps streaming while the person is on another
 * page and is there when they come back. The turn runs on the Mac to the end
 * whatever the browser does; this only follows.
 */

export type ChatState = {
  items: AgentFeedItem[];
  contexts: AgentContext[];
  activeContextId: string | null;
  /** Cursor for the page above what is shown; null at the start of the conversation. */
  before: string | null;
  loadingOlder: boolean;
  /** a turn is being followed (or being started) */
  streaming: boolean;
  /** the Coach is summarizing the context (in a turn, or the hourly summary) */
  compacting: boolean;
  /** read from the Mac at least once */
  loaded: boolean;
  error: string | null;
};

type Listener = () => void;

const API = "/api/web/coach/conversation";
const RETRIES = 5;
const SUMMARY_RECHECK_MS = 4000;

async function problem(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  if (response.status === 401) return "Este navegador ya no está emparejado con Pulso.";
  if (response.status === 403) return body?.message ?? "Este navegador no tiene permiso para escribir.";
  return body?.message ?? `La Mac respondió ${response.status}.`;
}

const localId = () => `local-${uuid()}`;
const offline = "No se pudo hablar con la Mac.";

/** Multipart only when there are photos; otherwise JSON, with the scanned barcodes when there are any. */
function messageBody(text: string, photos: Photo[], barcodes: string[]): RequestInit {
  if (!photos.length) return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(barcodes.length ? { text, barcodes } : { text }) };
  const form = new FormData();
  form.set("text", text);
  photos.forEach((p, i) => form.append("image", p.blob, `foto-${i + 1}.jpg`));
  for (const code of barcodes) form.append("barcode", code);
  return { method: "POST", body: form };
}

const lastMessageIndex = (items: AgentFeedItem[]) => items.findLastIndex((i) => i.type === "message");

export class Chat {
  private state: ChatState = { items: [], contexts: [], activeContextId: null, before: null, loadingOlder: false, streaming: false, compacting: false, loaded: false, error: null };
  private listeners = new Set<Listener>();
  private following = false;
  /** The server said a turn is in flight: `start()` re-attaches. */
  private pendingAttach = false;
  /** Rows written in this browser keep a local id (stable rows): local → the Mac's (undo names it) and back. */
  private serverIds = new Map<string, string>();
  private localOf = new Map<string, string>();
  /** The SDK summarized during the turn: re-read the feed for its marker once it ends. */
  private compactedInTurn = false;
  private recheck: ReturnType<typeof setTimeout> | null = null;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = () => this.state;

  private set(patch: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>), silent = false) {
    this.state = { ...this.state, ...(typeof patch === "function" ? patch(this.state) : patch) };
    if (silent) return;
    for (const listener of this.listeners) listener();
  }

  /** The reply being written: the last message, when it is the Coach's. */
  private patchLast(update: (m: AgentMessage) => AgentMessage) {
    this.set((s) => {
      const at = lastMessageIndex(s.items);
      const last = s.items[at];
      if (last?.type !== "message" || last.message.role !== "assistant") return {};
      const items = [...s.items];
      items[at] = { type: "message", message: update(last.message) };
      return { items };
    });
  }

  /** What the server rendered, taken during render (so silently). Ignored once the chat is live. */
  seed(view: AgentConversation) {
    if (this.following || this.state.loaded) return;
    this.take(view, true);
  }

  /** From an effect: re-attaches to the turn the server said is in flight. */
  start() {
    this.watchSummary();
    if (!this.pendingAttach || this.following) return;
    this.pendingAttach = false;
    void this.follow(() => fetch(`${API}/turn`, { cache: "no-store" }));
  }

  /** An hourly summary has no stream to say it ended: re-read the feed until the Mac says it did. */
  private watchSummary() {
    if (this.recheck || !this.state.compacting || this.following) return;
    this.recheck = setTimeout(() => {
      this.recheck = null;
      void this.resume();
    }, SUMMARY_RECHECK_MS);
  }

  /** Re-reads the latest page unless a stream is live (e.g. the tab comes back into view). */
  async resume() {
    if (this.following) return;
    const response = await fetch(API, { cache: "no-store" }).catch(() => null);
    if (!response?.ok || this.following) return;
    this.take((await response.json()) as AgentConversation);
    this.start();
  }

  private take(view: AgentConversation, silent = false) {
    const { items, continuous } = mergeLatest(this.state.items, view.items, this.localOf);
    const at = lastMessageIndex(items);
    const last = items[at];
    const attach = view.running && last?.type === "message" && last.message.role === "assistant" && last.message.status === "streaming";
    if (attach) {
      // The re-attached stream replays the turn from its start.
      items[at] = { type: "message", message: { ...last.message, text: "", tools: [] } };
    }
    this.pendingAttach = attach;
    const keepsOlder = continuous && items.length > view.items.length;
    this.set(
      { items, before: keepsOlder ? this.state.before : view.before, contexts: view.contexts, activeContextId: view.activeContextId, compacting: view.compacting, loaded: true, streaming: attach },
      silent,
    );
  }

  /** The page above what is shown. */
  async loadOlder() {
    const before = this.state.before;
    if (!before || this.state.loadingOlder) return;
    this.set({ loadingOlder: true });
    const response = await fetch(`${API}?before=${encodeURIComponent(before)}`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return this.set({ loadingOlder: false });
    const page = (await response.json()) as AgentConversation;
    this.set((s) => ({ items: prependOlder(s.items, page.items), before: page.before, loadingOlder: false }));
  }

  /** False when nothing was sent (the composer gives the text, photos and products back). */
  async send(raw: string, photos: Photo[] = [], products: AgentProduct[] = []): Promise<boolean> {
    const text = raw.trim();
    if ((!text && !photos.length && !products.length) || this.state.streaming) return false;
    const now = Date.now();
    const base = { threadId: "", contextId: this.state.activeContextId, source: null, tools: [], status: "done" as const, error: null, createdAt: now };
    this.set((s) => ({
      error: null,
      streaming: true,
      items: [
        ...s.items,
        { type: "message", message: { ...base, id: localId(), role: "user", text, attachments: rememberLocal(photos), products } },
        { type: "message", message: { ...base, id: localId(), role: "assistant", text: "", attachments: [], products: [], status: "streaming" } },
      ],
    }));
    void this.follow(() => fetch(`${API}/messages`, messageBody(text, photos, products.map((p) => p.barcode))));
    return true;
  }

  /** The person's stop. The stream then ends by itself with what was written. */
  async stop() {
    if (!this.state.streaming) return;
    const response = await fetch(`${API}/turn`, { method: "DELETE" }).catch(() => null);
    if (response && !response.ok && response.status !== 404) this.set({ error: await problem(response) });
  }

  /** Deshacer on an action card: the Mac puts the change back and the card shows it undone. Null, or what went wrong. */
  async undo(message: AgentMessage, index: number): Promise<string | null> {
    const messageId = this.serverIds.get(message.id) ?? message.id;
    if (messageId.startsWith("local-")) return "Esta respuesta todavía no está en la Mac.";
    const response = await fetch(`${API}/messages/${messageId}/tools/${index}/undo`, { method: "POST" }).catch(() => null);
    if (!response?.ok) return response ? await problem(response) : offline;
    const saved = ((await response.json()) as AgentUndoResponse).message;
    this.set((s) => ({ items: s.items.map((i) => (i.type === "message" && i.message.id === message.id ? { type: "message", message: { ...saved, id: message.id } } : i)) }));
    return null;
  }

  /** «Contexto nuevo», or «Volver a este contexto» with an id. Null, or what went wrong. */
  async context(id?: string): Promise<string | null> {
    if (this.state.streaming) return "Espera a que el Coach termine de responder.";
    const response = await fetch(id ? `${API}/contexts/${id}` : `${API}/contexts`, { method: "POST" }).catch(() => null);
    if (!response?.ok) return response ? await problem(response) : offline;
    this.take((await response.json()) as AgentConversation);
    return null;
  }

  /** «Responder» on a brief: it goes into the conversation as the Coach's message. Null, or what went wrong. */
  async replyTo(briefId: string): Promise<string | null> {
    const response = await fetch(`/api/web/coach/briefs/${briefId}/reply`, { method: "POST" }).catch(() => null);
    if (!response?.ok) return response ? await problem(response) : offline;
    await this.resume();
    return null;
  }

  /** Nothing reached the Mac: take the two placeholders back. */
  private failSend(message: string) {
    this.set((s) => ({ streaming: false, items: s.items.slice(0, -2), error: message }));
  }

  /**
   * Follows a turn's NDJSON. A lost stream (network, sleep) re-reads the feed:
   * if the Mac is still answering it re-attaches, otherwise what it saved wins.
   */
  private async follow(open: () => Promise<Response>) {
    this.following = true;
    this.compactedInTurn = false;
    this.set({ streaming: true });
    let finished = false;
    let attempts = 0;
    let request = open;
    while (!finished) {
      const response = await request().catch(() => null);
      // A 404 while re-attaching only means the turn ended.
      if (response && !response.ok && (response.status !== 404 || request === open)) {
        const message = await problem(response);
        if (request === open && this.sending()) this.failSend(message);
        else this.set({ error: message });
        finished = true;
        break;
      }
      if (response?.ok && response.body) {
        try {
          for await (const event of readEvents(response.body)) {
            if (event.type === "start") this.adopt(event.messageId, event.userMessageId);
            if (event.type === "status") this.set({ compacting: event.status === "compacting" });
            // Anything else (the turn starting after an hourly summary, its boundary, text, a tool) means the summary is over.
            else if (this.state.compacting) this.set({ compacting: false });
            if (event.type === "compacted") this.compactedInTurn = true;
            this.patchLast((m) => applyEvent(m, event));
            if (event.type === "done" || event.type === "error") finished = true;
          }
        } catch {
          // Dropped: not something the person must act on.
        }
      }
      if (finished) break;
      const detail = await fetch(API, { cache: "no-store" }).catch(() => null);
      if (!detail?.ok) {
        if (++attempts > RETRIES) break;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      const view = (await detail.json()) as AgentConversation;
      this.take(view);
      this.pendingAttach = false;
      if (!this.state.streaming) {
        finished = true;
        break;
      }
      attempts = 0;
      request = () => fetch(`${API}/turn`, { cache: "no-store" });
    }
    this.following = false;
    this.set({ streaming: false, compacting: false });
    const last = this.state.items[lastMessageIndex(this.state.items)];
    if (!finished && last?.type === "message" && last.message.status === "streaming") {
      this.set({ error: "Sin conexión con la Mac. La respuesta se sigue guardando allá y aparecerá al volver." });
    }
    // The summary's marker, the contexts' counts.
    if (finished && this.compactedInTurn) void this.resume();
  }

  /** The send's two placeholders are still waiting for the Mac's `start`. */
  private sending(): boolean {
    const last = this.state.items[lastMessageIndex(this.state.items)];
    return last?.type === "message" && last.message.id.startsWith("local-") && !this.serverIds.has(last.message.id);
  }

  /** `start` names what the Mac saved for the two placeholders. */
  private adopt(assistantId: string, userId: string) {
    const messages = this.state.items.flatMap((i) => (i.type === "message" ? [i.message] : []));
    const assistant = messages.at(-1);
    const user = messages.at(-2);
    for (const [local, server] of [
      [assistant, assistantId],
      [user, userId],
    ] as const) {
      if (!local?.id.startsWith("local-")) continue;
      this.serverIds.set(local.id, server);
      this.localOf.set(server, local.id);
    }
  }
}

let chat: Chat | null = null;

/** The one live conversation in this browser. The server renders with a throwaway one. */
export function theChat(): Chat {
  if (typeof window === "undefined") return new Chat();
  return (chat ??= new Chat());
}

export function useChat(chat: Chat): ChatState {
  return useSyncExternalStore(chat.subscribe, chat.snapshot, chat.snapshot);
}

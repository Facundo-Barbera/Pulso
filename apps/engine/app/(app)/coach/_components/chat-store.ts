"use client";

import type { AgentMessage, AgentProduct, AgentThread, AgentUndoResponse, CoachBrief } from "@pulso/contract";
import { useSyncExternalStore } from "react";
import type { CoachThreadView } from "@/src/web/coach";
import { rememberLocal, type Photo } from "./photos";
import { applyEvent, readEvents } from "./stream";

/**
 * The web Coach's client state, outside React like iOS's ChatStore: one live
 * chat per thread, so a reply keeps streaming while the person opens another
 * thread or the route changes, and is there when they come back. The turn
 * runs on the Mac to the end whatever the browser does; a chat only follows.
 */

export type ChatState = {
  threadId: string | null;
  title: string | null;
  messages: AgentMessage[];
  /** a turn is being followed (or being started) */
  streaming: boolean;
  /** the thread has been read from the Mac at least once */
  loaded: boolean;
  error: string | null;
  /** a new chat replying to this brief: sending starts the thread from it */
  replyTo: CoachBrief | null;
};

type Listener = () => void;

const API = "/api/web/coach";
const RETRIES = 5;

async function problem(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  if (response.status === 401) return "Este navegador ya no está emparejado con Pulso.";
  if (response.status === 403) return body?.message ?? "Este navegador no tiene permiso para escribir.";
  return body?.message ?? `La Mac respondió ${response.status}.`;
}

const localId = () => `local-${crypto.randomUUID()}`;

/** Multipart only when there are photos; otherwise JSON, with the scanned barcodes when there are any. */
function messageBody(text: string, photos: Photo[], barcodes: string[]): RequestInit {
  if (!photos.length) return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(barcodes.length ? { text, barcodes } : { text }) };
  const form = new FormData();
  form.set("text", text);
  photos.forEach((p, i) => form.append("image", p.blob, `foto-${i + 1}.jpg`));
  for (const code of barcodes) form.append("barcode", code);
  return { method: "POST", body: form };
}

export class Chat {
  private state: ChatState;
  private listeners = new Set<Listener>();
  private following = false;
  /** The server said a turn is in flight: `start()` re-attaches. */
  private pendingAttach = false;
  /** Bumped by `forget`: a follow loop from before stops touching state. */
  private generation = 0;
  /** Replies written in this browser keep a local id (stable rows); the Mac's id, from `start`, is what undo names. */
  private serverIds = new Map<string, string>();

  constructor(threadId: string | null, replyTo: CoachBrief | null = null) {
    this.state = {
      threadId,
      title: null,
      messages: replyTo ? [{ id: localId(), threadId: "", role: "assistant", text: replyTo.text, attachments: [], products: [], tools: [], status: "done", error: null, createdAt: replyTo.updatedAt }] : [],
      streaming: false,
      loaded: threadId === null,
      error: null,
      replyTo,
    };
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = () => this.state;

  private set(patch: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>), silent = false) {
    this.state = { ...this.state, ...(typeof patch === "function" ? patch(this.state) : patch) };
    if (silent) return;
    for (const listener of this.listeners) listener();
    changed();
  }

  private patchLast(update: (m: AgentMessage) => AgentMessage) {
    this.set((s) => {
      const last = s.messages.at(-1);
      if (!last || last.role !== "assistant") return {};
      return { messages: [...s.messages.slice(0, -1), update(last)] };
    });
  }

  /** What the server rendered, taken during render (so silently). Ignored once the chat is live. */
  seed(view: CoachThreadView) {
    if (this.following || this.state.loaded) return;
    this.take(view, true);
  }

  /** From an effect: re-attaches to the turn the server said is in flight. */
  start() {
    if (!this.pendingAttach || this.following || !this.state.threadId) return;
    this.pendingAttach = false;
    const id = this.state.threadId;
    void this.follow(() => fetch(`${API}/threads/${id}/turn`, { cache: "no-store" }));
  }

  /** Re-reads the thread unless a stream is live (e.g. the tab comes back into view). */
  async resume() {
    const id = this.state.threadId;
    if (this.following || !id) return;
    const response = await fetch(`${API}/threads/${id}`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok || this.following) return;
    this.take((await response.json()) as CoachThreadView);
    this.start();
  }

  private take(view: CoachThreadView, silent = false) {
    const last = view.messages.at(-1);
    const attach = view.running && last?.role === "assistant" && last.status === "streaming";
    // The re-attached stream replays the turn from its start.
    const messages = attach ? [...view.messages.slice(0, -1), { ...last, text: "", tools: [] }] : view.messages;
    this.pendingAttach = attach;
    this.set({ title: view.thread.title, messages, loaded: true, streaming: attach }, silent);
  }

  /** False when nothing was sent (the composer gives the text, photos and products back). */
  async send(raw: string, photos: Photo[] = [], products: AgentProduct[] = []): Promise<boolean> {
    const text = raw.trim();
    if ((!text && !photos.length && !products.length) || this.state.streaming) return false;
    const now = Date.now();
    this.set((s) => ({
      error: null,
      streaming: true,
      messages: [
        ...s.messages,
        { id: localId(), threadId: s.threadId ?? "", role: "user", text, attachments: rememberLocal(photos), products, tools: [], status: "done", error: null, createdAt: now },
        { id: localId(), threadId: s.threadId ?? "", role: "assistant", text: "", attachments: [], products: [], tools: [], status: "streaming", error: null, createdAt: now },
      ],
    }));
    if (!this.state.threadId) {
      const brief = this.state.replyTo;
      const response = await fetch(brief ? `${API}/briefs/${brief.id}/thread` : `${API}/threads`, { method: "POST" }).catch(() => null);
      if (!response?.ok) {
        this.failSend(response ? await problem(response) : "No se pudo hablar con la Mac.");
        return false;
      }
      const { thread } = (await response.json()) as { thread: AgentThread };
      live.set(thread.id, this);
      this.set({ threadId: thread.id, title: thread.title, replyTo: null });
      upsertThread(thread);
    }
    const id = this.state.threadId!;
    void this.follow(() => fetch(`${API}/threads/${id}/messages`, messageBody(text, photos, products.map((p) => p.barcode))));
    return true;
  }

  /** The person's stop. The stream then ends by itself with what was written. */
  async stop() {
    const id = this.state.threadId;
    if (!id || !this.state.streaming) return;
    const response = await fetch(`${API}/threads/${id}/turn`, { method: "DELETE" }).catch(() => null);
    if (response && !response.ok && response.status !== 404) this.set({ error: await problem(response) });
  }

  /** Deshacer on an action card: the Mac puts the change back and the card shows it undone. Null, or what went wrong. */
  async undo(message: AgentMessage, index: number): Promise<string | null> {
    const id = this.state.threadId;
    if (!id) return "Esta conversación todavía no está en la Mac.";
    const messageId = this.serverIds.get(message.id) ?? message.id;
    const response = await fetch(`${API}/threads/${id}/messages/${messageId}/tools/${index}/undo`, { method: "POST" }).catch(() => null);
    if (!response?.ok) return response ? await problem(response) : "No se pudo hablar con la Mac.";
    const saved = ((await response.json()) as AgentUndoResponse).message;
    this.set((s) => ({ messages: s.messages.map((m) => (m.id === message.id ? { ...saved, id: m.id } : m)) }));
    return null;
  }

  /** Nothing reached the Mac: take the two placeholders back. */
  private failSend(message: string) {
    this.set((s) => ({ streaming: false, messages: s.messages.slice(0, -2), error: message }));
  }

  /**
   * Follows a turn's NDJSON. A lost stream (network, sleep) re-reads the thread:
   * if the Mac is still answering it re-attaches, otherwise what it saved wins.
   */
  private async follow(open: () => Promise<Response>) {
    const generation = this.generation;
    const current = () => generation === this.generation;
    this.following = true;
    this.set({ streaming: true });
    let finished = false;
    let attempts = 0;
    let request = open;
    while (!finished && current()) {
      const response = await request().catch(() => null);
      // A 404 while re-attaching only means the turn ended; on the first request the thread is gone.
      if (response && !response.ok && (response.status !== 404 || request === open)) {
        const message = await problem(response);
        // Nothing started: the person's message was not sent.
        if (request === open && this.state.messages.at(-1)?.text === "") this.patchLast((m) => ({ ...m, status: "error", error: message }));
        else this.set({ error: message });
        finished = true;
        break;
      }
      if (response?.ok && response.body) {
        try {
          for await (const event of readEvents(response.body)) {
            if (!current()) return;
            if (event.type === "start") {
              const last = this.state.messages.at(-1);
              if (last?.role === "assistant") this.serverIds.set(last.id, event.messageId);
            }
            this.patchLast((m) => applyEvent(m, event));
            // The first message titles the thread on the Mac.
            if (event.type === "start") void this.refreshTitle();
            if (event.type === "done" || event.type === "error") finished = true;
          }
        } catch {
          // Dropped: not something the person must act on.
        }
      }
      if (finished || !current()) break;
      const id = this.state.threadId;
      const detail = id ? await fetch(`${API}/threads/${id}`, { cache: "no-store" }).catch(() => null) : null;
      if (!detail?.ok) {
        if (++attempts > RETRIES) break;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      const view = (await detail.json()) as CoachThreadView;
      const last = view.messages.at(-1);
      if (!view.running || last?.status !== "streaming") {
        this.set({ title: view.thread.title, messages: view.messages });
        finished = true;
        break;
      }
      this.set({ title: view.thread.title, messages: [...view.messages.slice(0, -1), { ...last, text: "", tools: [] }] });
      attempts = 0;
      request = () => fetch(`${API}/threads/${id}/turn`, { cache: "no-store" });
    }
    if (!current()) return;
    this.following = false;
    this.set({ streaming: false });
    if (!finished && this.state.messages.at(-1)?.status === "streaming") {
      this.set({ error: "Sin conexión con la Mac. La respuesta se sigue guardando allá y aparecerá al volver." });
    }
    void refreshThreads();
  }

  private async refreshTitle() {
    const id = this.state.threadId;
    const response = id ? await fetch(`${API}/threads/${id}`, { cache: "no-store" }).catch(() => null) : null;
    if (response?.ok) this.set({ title: ((await response.json()) as CoachThreadView).thread.title });
    void refreshThreads();
  }

  /** Stops following (the thread was deleted). */
  forget() {
    this.generation++;
    this.following = false;
  }
}

const live = new Map<string, Chat>();

/** The live chat for a thread: the same one each time. The server renders with a throwaway one. */
export function chatFor(threadId: string): Chat {
  if (typeof window === "undefined") return new Chat(threadId);
  let chat = live.get(threadId);
  if (!chat) live.set(threadId, (chat = new Chat(threadId)));
  return chat;
}

export function useChat(chat: Chat): ChatState {
  return useSyncExternalStore(chat.subscribe, chat.snapshot, chat.snapshot);
}

// ── The thread list ─────────────────────────────────────────────────────────

let threads: AgentThread[] | null = null;
const threadListeners = new Set<Listener>();
const emitThreads = () => threadListeners.forEach((l) => l());

/** Thread ids with a reply streaming in this browser, as a stable string so the list only redraws when it changes. */
let streaming = "";
function changed() {
  const next = [...live].filter(([, chat]) => chat.snapshot().streaming).map(([id]) => id).join(" ");
  if (next === streaming) return;
  streaming = next;
  emitThreads();
}

/** The server's list on a fresh render; the browser's own once it has one. */
export function seedThreads(initial: AgentThread[]) {
  if (typeof window !== "undefined" && threads === null) threads = initial;
}

function upsertThread(thread: AgentThread) {
  threads = [thread, ...(threads ?? []).filter((t) => t.id !== thread.id)];
  emitThreads();
}

export async function refreshThreads() {
  const response = await fetch(`${API}/threads`, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return;
  threads = ((await response.json()) as { threads: AgentThread[] }).threads;
  emitThreads();
}

export async function deleteThread(id: string): Promise<string | null> {
  const response = await fetch(`${API}/threads/${id}`, { method: "DELETE" }).catch(() => null);
  if (!response || (!response.ok && response.status !== 404)) return response ? await problem(response) : "No se pudo hablar con la Mac.";
  live.get(id)?.forget();
  live.delete(id);
  threads = (threads ?? []).filter((t) => t.id !== id);
  emitThreads();
  return null;
}

const subscribeThreads = (listener: Listener) => {
  threadListeners.add(listener);
  return () => threadListeners.delete(listener);
};

/** The list (the server's until the browser has its own) and the ids with a reply streaming here. */
export function useThreads(initial: AgentThread[]): { threads: AgentThread[]; streaming: Set<string> } {
  const list = useSyncExternalStore(subscribeThreads, () => threads ?? initial, () => initial);
  const ids = useSyncExternalStore(subscribeThreads, () => streaming, () => "");
  return { threads: list, streaming: new Set(ids ? ids.split(" ") : []) };
}

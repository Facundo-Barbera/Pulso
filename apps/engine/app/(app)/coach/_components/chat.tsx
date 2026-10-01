"use client";

import type { CoachBrief } from "@pulso/contract";
import { AlertTriangle, ArrowDown, ChevronLeft, SquarePen, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CoachThreadView } from "@/src/web/coach";
import { cn } from "../../../_ui/cn";
import { CoachAvatar } from "./bits";
import { BriefCard } from "./brief-card";
import { Chat, chatFor, deleteThread, useChat } from "./chat-store";
import { Composer } from "./composer";
import { MessageRow } from "./message";
import { STARTERS } from "./starters";

/** An existing conversation. Re-attaches to a reply in flight, also after a reload. */
export function ThreadView({ initial }: { initial: CoachThreadView }) {
  const [chat] = useState(() => {
    const live = chatFor(initial.thread.id);
    live.seed(initial);
    return live;
  });
  useEffect(() => {
    chat.start();
    // Back from another tab or from sleep: what the Mac saved meanwhile.
    const onVisible = () => document.visibilityState === "visible" && void chat.resume();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [chat]);
  return <ChatView chat={chat} />;
}

/** A fresh conversation: the brief, quick prompts, a composer. Becomes `/coach/<id>` once it has a thread. */
export function NewChatView({ brief, replyTo, starter }: { brief: CoachBrief | null; replyTo: CoachBrief | null; starter: string | null }) {
  const router = useRouter();
  const [chat, setChat] = useState(() => new Chat(null, replyTo));
  const state = useChat(chat);
  const sentStarter = useRef(false);

  useEffect(() => {
    if (state.threadId) router.replace(`/coach/${state.threadId}`, { scroll: false });
  }, [state.threadId, router]);

  useEffect(() => {
    if (!starter || sentStarter.current) return;
    sentStarter.current = true;
    void chat.send(starter);
  }, [starter, chat]);

  return <ChatView chat={chat} brief={brief} onReply={(b) => setChat(new Chat(null, b))} />;
}

function ChatView({ chat, brief, onReply }: { chat: Chat; brief?: CoachBrief | null; onReply?: (brief: CoachBrief) => void }) {
  const state = useChat(chat);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const fresh = state.messages.length === 0;
  const replying = state.replyTo !== null;

  function toBottom(smooth = false) {
    const el = scroller.current;
    if (!el) return;
    following.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  // Streaming text keeps the end in view while the person is reading it.
  useLayoutEffect(() => {
    if (following.current) toBottom();
  }, [state.messages]);

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col" aria-label={state.title ?? "Nueva conversación"}>
      <ChatHeader chat={chat} title={replying ? "Respuesta al resumen" : (state.title ?? "Nueva conversación")} streaming={state.streaming} />

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          following.current = bottom;
          setAtBottom(bottom);
        }}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-5 pt-4 pb-8 md:px-8 md:pt-6">
          {fresh ? (
            <Welcome brief={brief ?? null} onPick={(text) => void chat.send(text)} onReply={onReply} />
          ) : (
            state.messages.map((message, i) => <MessageRow key={message.id} message={message} last={i === state.messages.length - 1} />)
          )}
          {state.error && (
            <p className="text-warning bg-warning/10 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[13.5px]" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {state.error}
            </p>
          )}
        </div>
      </div>

      <div className="relative shrink-0 pt-2 pb-[calc(68px+env(safe-area-inset-bottom))] md:pb-4">
        {!atBottom && !fresh && (
          <button
            onClick={() => toBottom(true)}
            className="bg-card shadow-2 border-border text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute -top-12 left-1/2 grid size-10 -translate-x-1/2 place-items-center rounded-full border outline-none focus-visible:ring-2 motion-safe:animate-[pulso-rise_200ms_ease-out_both]"
            aria-label="Ir al final"
          >
            <ArrowDown className="size-4" />
          </button>
        )}
        <Composer
          key={replying ? "reply" : "chat"}
          streaming={state.streaming}
          autoFocus={fresh || replying}
          placeholder={replying ? "Contéstale al Coach…" : undefined}
          onSend={(text) => {
            following.current = true;
            return chat.send(text);
          }}
          onStop={() => void chat.stop()}
        />
      </div>
    </section>
  );
}

function ChatHeader({ chat, title, streaming }: { chat: Chat; title: string; streaming: boolean }) {
  const router = useRouter();
  const state = useChat(chat);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const icon = "app-no-drag text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-10 place-items-center rounded-full outline-none focus-visible:ring-2";

  async function remove() {
    if (!state.threadId) return;
    const problem = await deleteThread(state.threadId);
    if (problem) {
      setError(problem);
      setConfirming(false);
    } else router.push("/coach");
  }

  return (
    <header className="app-drag border-border/60 relative z-10 flex min-h-14 shrink-0 items-center gap-1 border-b px-2 pt-[env(safe-area-inset-top)] md:h-[var(--titlebar-height)] md:min-h-0 md:px-4 md:pt-0">
      <Link href="/coach" className={cn(icon, "md:hidden")} aria-label="Conversaciones">
        <ChevronLeft className="size-5" />
      </Link>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1">
        <CoachAvatar size={24} active={streaming} className="max-md:hidden" />
        <h1 className="truncate text-[15px] font-semibold tracking-tight">{title}</h1>
      </div>
      {error && <span className="text-warning truncate text-[12.5px]">{error}</span>}
      {state.threadId &&
        (confirming ? (
          <span className="app-no-drag flex items-center gap-1.5">
            <button onClick={() => setConfirming(false)} className="hover:bg-muted min-h-9 rounded-lg px-2.5 text-[13px]">
              Cancelar
            </button>
            <button onClick={remove} className="bg-destructive text-background min-h-9 rounded-lg px-2.5 text-[13px] font-medium">
              Eliminar
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirming(true)} disabled={streaming} className={cn(icon, "disabled:opacity-40")} aria-label="Eliminar conversación" title={streaming ? "Espera a que termine la respuesta" : "Eliminar conversación"}>
            <Trash2 className="size-[17px]" />
          </button>
        ))}
      <Link href="/coach/nuevo" className={cn(icon, "md:hidden")} aria-label="Nueva conversación">
        <SquarePen className="size-[18px]" />
      </Link>
    </header>
  );
}

/** The designed empty chat: today's brief on top, then a greeting and the quick prompts. */
function Welcome({ brief, onPick, onReply }: { brief: CoachBrief | null; onPick: (text: string) => void; onReply?: (brief: CoachBrief) => void }) {
  return (
    <div className="flex flex-col gap-8">
      {onReply && <BriefCard initial={brief} onReply={onReply} />}
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <div className="relative">
          <div className="absolute inset-0 scale-150 rounded-full opacity-35 blur-2xl" style={{ background: "var(--pulso-gradient)" }} aria-hidden />
          <CoachAvatar size={56} className="relative" />
        </div>
        <div>
          <p className="text-[22px] font-semibold tracking-tight">¿En qué te ayudo?</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-[14.5px] leading-relaxed">Rutinas, comidas y progreso, pensados con tus datos.</p>
        </div>
      </div>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {STARTERS.map(({ text, icon: Icon, color }, i) => (
          <li key={text} className="motion-safe:animate-[pulso-rise_360ms_cubic-bezier(.2,.7,.2,1)_both]" style={{ animationDelay: `${80 + i * 60}ms` }}>
            <button
              onClick={() => onPick(text)}
              className="bg-card shadow-1 hover:shadow-2 focus-visible:ring-ring flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[14.5px] font-medium outline-none transition-shadow focus-visible:ring-2"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}>
                <Icon className="size-[17px]" />
              </span>
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

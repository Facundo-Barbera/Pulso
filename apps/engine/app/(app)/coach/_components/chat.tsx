"use client";

import type { AgentContext, AgentConversation, AgentFeedMarker, CoachBrief } from "@pulso/contract";
import { AlertTriangle, ArrowDown, History, Layers, Loader2, Plus, Sparkles, Sunrise, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../../_ui/cn";
import { fmtShortDate } from "../../../_ui/format";
import { CoachAvatar } from "./bits";
import { BriefCard } from "./brief-card";
import { type Chat, theChat, useChat } from "./chat-store";
import { Composer } from "./composer";
import { MessageRow } from "./message";
import { STARTERS } from "./starters";

/** Scrolled this close to the top, the page above loads. */
const OLDER_AT_PX = 240;

/**
 * The Coach: one conversation, oldest at the top, the composer at the bottom.
 * Re-attaches to a reply in flight, also after a reload. `starter` sends a
 * prompt at once (`/coach?q=`); `replyTo` quotes a brief into it (`?responder=`).
 */
export function CoachFeed({ initial, brief, starter, replyTo }: { initial: AgentConversation; brief: CoachBrief | null; starter: string | null; replyTo: string | null }) {
  const router = useRouter();
  const [chat] = useState(() => {
    const live = theChat();
    live.seed(initial);
    return live;
  });
  const state = useChat(chat);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  /** Distance from the bottom before an older page went on top, to keep the same rows in view. */
  const anchor = useRef<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [showBrief, setShowBrief] = useState(false);
  const [focus, setFocus] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const handled = useRef(false);
  const messages = state.items.filter((i) => i.type === "message").length;
  const fresh = state.loaded && messages === 0;

  useEffect(() => {
    chat.start();
    // Back from another tab or from sleep: what the Mac saved meanwhile.
    const onVisible = () => document.visibilityState === "visible" && void chat.resume();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [chat]);

  // A link that asked for something: done once, then the URL goes back to /coach.
  useEffect(() => {
    if (handled.current || (!starter && !replyTo)) return;
    handled.current = true;
    void (async () => {
      following.current = true;
      if (replyTo) {
        const problem = await chat.replyTo(replyTo);
        if (problem) setNotice(problem);
        else setFocus((n) => n + 1);
      }
      if (starter) await chat.send(starter);
      router.replace("/coach", { scroll: false });
    })();
  }, [chat, starter, replyTo, router]);

  function toBottom(smooth = false) {
    const el = scroller.current;
    if (!el) return;
    following.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  // An older page keeps what was on screen where it was; otherwise streaming text keeps the end in view.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && anchor.current !== null) {
      el.scrollTop = el.scrollHeight - anchor.current;
      anchor.current = null;
    } else if (following.current) toBottom();
  }, [state.items]);

  function onScroll(el: HTMLDivElement) {
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    following.current = bottom;
    setAtBottom(bottom);
    if (el.scrollTop < OLDER_AT_PX && state.before && !state.loadingOlder) {
      anchor.current = el.scrollHeight - el.scrollTop;
      void chat.loadOlder();
    }
  }

  // What these add goes at the bottom: follow it there.
  async function reply(b: CoachBrief) {
    setShowBrief(false);
    following.current = true;
    const problem = await chat.replyTo(b.id);
    if (problem) return setNotice(problem);
    setFocus((n) => n + 1);
  }

  async function context(id?: string) {
    setNotice(null);
    following.current = true;
    const problem = await chat.context(id);
    if (problem) setNotice(problem);
    else setFocus((n) => n + 1);
  }

  const contextStart = (id: string) => state.contexts.find((c) => c.id === id)?.startedAt;

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col" aria-label="Coach">
      <FeedHeader chat={chat} onBrief={() => setShowBrief((s) => !s)} briefOpen={showBrief} onContext={context} />

      <div ref={scroller} onScroll={(e) => onScroll(e.currentTarget)} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-5 pt-4 pb-8 md:px-8 md:pt-6">
          {showBrief && !fresh && <BriefCard initial={brief} onReply={reply} />}
          {state.loadingOlder && (
            <p className="text-muted-foreground flex items-center justify-center gap-2 text-[12.5px]">
              <Loader2 className="size-3.5 motion-safe:animate-spin" />
              Cargando lo anterior…
            </p>
          )}
          {fresh && <Welcome brief={brief} onPick={(text) => void chat.send(text)} onReply={reply} />}
          {state.items.map((item, i) =>
            item.type === "marker" ? (
              <Divider
                key={`marker:${item.marker.id}`}
                marker={item.marker}
                active={item.marker.contextId === state.activeContextId}
                startedAt={contextStart(item.marker.contextId)}
                disabled={state.streaming}
                onReturn={() => void context(item.marker.contextId)}
              />
            ) : (
              <MessageRow key={item.message.id} message={item.message} last={i === state.items.length - 1} onUndo={(index) => chat.undo(item.message, index)} />
            ),
          )}
          {state.compacting && (
            <p className="text-muted-foreground flex items-center gap-2 text-[13px]" role="status">
              <Loader2 className="size-3.5 motion-safe:animate-spin" />
              Compactando lo anterior…
            </p>
          )}
          {(state.error || notice) && (
            <p className="text-warning bg-warning/10 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[13.5px]" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {state.error ?? notice}
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
          key={focus}
          streaming={state.streaming}
          autoFocus={fresh || focus > 0}
          onSend={(text, photos, products) => {
            following.current = true;
            return chat.send(text, photos, products);
          }}
          onStop={() => void chat.stop()}
        />
      </div>
    </section>
  );
}

function FeedHeader({ chat, onBrief, briefOpen, onContext }: { chat: Chat; onBrief: () => void; briefOpen: boolean; onContext: (id?: string) => void }) {
  const state = useChat(chat);
  const icon = "app-no-drag text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-10 place-items-center rounded-full outline-none focus-visible:ring-2";
  const status = state.compacting ? "compactando…" : state.streaming ? "respondiendo…" : null;
  return (
    <header className="app-drag border-border/60 relative z-10 flex min-h-14 shrink-0 items-center gap-1 border-b px-3 pt-[env(safe-area-inset-top)] md:h-[var(--titlebar-height)] md:min-h-0 md:px-4 md:pt-0">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1">
        <CoachAvatar size={26} active={state.streaming} />
        <h1 className="text-[15px] font-semibold tracking-tight">Coach</h1>
        {status && <span className="text-muted-foreground truncate text-[12.5px]">{status}</span>}
      </div>
      <button onClick={onBrief} className={cn(icon, briefOpen && "text-foreground bg-muted")} aria-label="Resumen del Coach" aria-pressed={briefOpen} title="Resumen del Coach">
        <Sunrise className="size-[18px]" />
      </button>
      <ContextMenu contexts={state.contexts} disabled={state.streaming} onPick={onContext} className={icon} />
    </header>
  );
}

const describe = (c: AgentContext) => `${fmtShortDate(c.startedAt)} · ${c.messageCount === 1 ? "1 mensaje" : `${c.messageCount} mensajes`}`;

/** «Contexto nuevo» and the earlier contexts to go back to, behind one quiet button. */
function ContextMenu({ contexts, disabled, onPick, className }: { contexts: AgentContext[]; disabled: boolean; onPick: (id?: string) => void; className: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const past = contexts.filter((c) => !c.active && c.messageCount > 0).slice(0, 8);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const pick = (id?: string) => {
    setOpen(false);
    onPick(id);
  };
  const item = "hover:bg-muted focus-visible:bg-muted flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] outline-none disabled:opacity-50";

  return (
    <div ref={box} className="app-no-drag relative">
      <button onClick={() => setOpen((o) => !o)} className={className} aria-label="Contexto" aria-expanded={open} title="Contexto">
        <Layers className="size-[18px]" />
      </button>
      {open && (
        <div className="bg-card shadow-2 border-border absolute top-full right-0 z-20 mt-1 w-72 rounded-xl border p-1.5 motion-safe:animate-[pulso-rise_160ms_ease-out_both]" role="menu">
          <button role="menuitem" onClick={() => pick()} disabled={disabled} className={item}>
            <Plus className="text-muted-foreground size-4" />
            <span className="flex-1">
              Contexto nuevo
              <span className="text-muted-foreground block text-[12px]">El Coach empieza de cero; tu perfil sigue.</span>
            </span>
          </button>
          {past.length > 0 && (
            <>
              <p className="text-muted-foreground px-2.5 pt-2 pb-1 text-[11.5px] font-medium tracking-wide uppercase">Volver a</p>
              {past.map((c) => (
                <button key={c.id} role="menuitem" onClick={() => pick(c.id)} disabled={disabled} className={item}>
                  <History className="text-muted-foreground size-4" />
                  <span className="flex-1" suppressHydrationWarning>
                    Contexto del {describe(c)}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A quiet line in the feed: a context started, was resumed, or the Coach summarized what came before. */
function Divider({ marker, active, startedAt, disabled, onReturn }: { marker: AgentFeedMarker; active: boolean; startedAt?: number; disabled: boolean; onReturn: () => void }) {
  const label =
    marker.kind === "context"
      ? `Contexto nuevo · ${fmtShortDate(marker.createdAt)}`
      : marker.kind === "switch"
        ? `Volviste al contexto del ${fmtShortDate(startedAt ?? marker.createdAt)}`
        : marker.kind === "distilled"
          ? "Partí de un resumen de tus conversaciones anteriores"
          : "Resumí lo anterior para seguir";
  const Icon = marker.kind === "compacted" ? Sparkles : marker.kind === "switch" ? Undo2 : Layers;
  const canReturn = !active && (marker.kind === "context" || marker.kind === "distilled");
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-[12.5px]" role="separator" aria-label={label}>
      <span className="bg-border h-px flex-1" />
      <span className="flex min-w-0 items-center gap-1.5 text-center" suppressHydrationWarning>
        <Icon className="size-3.5 shrink-0" />
        {label}
      </span>
      {canReturn && (
        <button onClick={onReturn} disabled={disabled} className="hover:text-foreground focus-visible:ring-ring shrink-0 rounded-full px-1.5 font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 disabled:opacity-50">
          Volver a este contexto
        </button>
      )}
      <span className="bg-border h-px flex-1" />
    </div>
  );
}

/** The designed empty feed: today's brief on top, then a greeting and the quick prompts. */
function Welcome({ brief, onPick, onReply }: { brief: CoachBrief | null; onPick: (text: string) => void; onReply: (brief: CoachBrief) => void }) {
  return (
    <div className="flex flex-col gap-8">
      <BriefCard initial={brief} onReply={onReply} />
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

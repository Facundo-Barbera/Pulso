"use client";

import type { AgentMessage, AgentToolResult, AgentToolUse } from "@pulso/contract";
import { AlertTriangle, Check, ChevronRight, Copy, Share } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "../../../_ui/cn";
import { Markdown } from "../../../_ui/markdown";
import { CoachAvatar, copyText, ThinkingDots } from "./bits";
import { RESULT_PLACES, toolLook } from "./tools";

export function MessageRow({ message, last }: { message: AgentMessage; last: boolean }) {
  return message.role === "user" ? <UserBubble message={message} /> : <AssistantRow message={message} last={last} />;
}

function UserBubble({ message }: { message: AgentMessage }) {
  return (
    <div className="group flex items-end justify-end gap-1 pl-10 motion-safe:animate-[pulso-rise_280ms_ease-out_both] md:pl-20">
      <Actions text={message.text} className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-md:hidden" />
      <p className="bg-primary text-primary-foreground min-w-0 rounded-[22px] rounded-br-md px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap">{message.text}</p>
    </div>
  );
}

function AssistantRow({ message, last }: { message: AgentMessage; last: boolean }) {
  const streaming = message.status === "streaming";
  const thinking = streaming && !message.text && !message.tools.some((t) => t.status === "running");
  // Tools that made something get a card; the rest show as activity chips, a finished activity once.
  const activity = message.tools.filter((t, i, all) => (!t.result || t.status !== "done") && (t.status !== "done" || all.findIndex((o) => o.status === "done" && !o.result && toolLook(o.name).label === toolLook(t.name).label) === i));
  const results = message.tools.flatMap((t) => (t.status === "done" && t.result ? [t.result] : []));

  return (
    <div className="group/msg flex flex-col gap-3.5 motion-safe:animate-[pulso-rise_280ms_ease-out_both]">
      {activity.length > 0 && <ToolChips tools={activity} />}
      {thinking && (
        <div className="flex items-center gap-2.5">
          <CoachAvatar size={28} active />
          <ThinkingDots />
        </div>
      )}
      {message.text && <Markdown text={message.text} className="space-y-3 text-[15.5px] leading-[1.65]" />}
      {results.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {results.map((result, i) => (
            <ResultCard key={i} result={result} />
          ))}
        </div>
      )}
      {message.status === "error" && (
        <p className="text-warning flex items-start gap-2 text-[13.5px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {message.error ?? "El Coach no pudo responder."}
        </p>
      )}
      {message.status === "done" && message.text && <Actions text={message.text} className={cn(!last && "opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 max-md:opacity-100")} />}
    </div>
  );
}

/** "Revisando tus métricas del día…": what the Coach is doing, in the person's words. */
function ToolChips({ tools }: { tools: AgentToolUse[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Lo que está haciendo el Coach">
      {tools.map((tool, i) => {
        const look = toolLook(tool.name);
        const Icon = tool.status === "running" ? look.icon : tool.status === "done" ? Check : AlertTriangle;
        const running = tool.status === "running";
        return (
          <li
            key={i}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors motion-safe:animate-[pulso-rise_220ms_ease-out_both]", !running && "text-muted-foreground")}
            style={{ background: `color-mix(in oklab, ${tool.status === "error" ? "var(--warning)" : look.color} ${running ? 16 : 8}%, transparent)` }}
          >
            <Icon className={cn("size-3.5 shrink-0", running && "motion-safe:animate-pulse")} style={{ color: tool.status === "error" ? "var(--warning)" : look.color }} strokeWidth={2.4} />
            {running ? `${look.label}…` : look.label}
          </li>
        );
      })}
    </ul>
  );
}

/** "Comida registrada · Avena · 350 kcal — Abrir en Dieta": what a tool made, one click from where it lives. */
function ResultCard({ result }: { result: AgentToolResult }) {
  const place = RESULT_PLACES[result.tab] ?? RESULT_PLACES.hoy;
  const Icon = place.icon;
  return (
    <Link
      href={place.href}
      className="bg-card shadow-1 hover:shadow-2 focus-visible:ring-ring group flex min-h-16 items-center gap-3.5 rounded-2xl p-3.5 outline-none transition-shadow focus-visible:ring-2"
      style={{ background: `color-mix(in oklab, ${place.color} 7%, var(--card))` }}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in oklab, ${place.color} 18%, transparent)`, color: place.color }}>
        <Icon className="size-5" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold">{result.title}</span>
        {result.detail && <span className="text-muted-foreground line-clamp-2 block text-[13px]">{result.detail}</span>}
        {/* Mixed toward the text colour so yellows stay readable in light mode. */}
        <span className="mt-0.5 block text-[12px] font-semibold" style={{ color: `color-mix(in oklab, ${place.color} 75%, var(--foreground))` }}>
          Abrir en {place.name}
        </span>
      </span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** Copy and, where the browser can, share. */
function Actions({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === "function"), []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const button = "text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-8 place-items-center rounded-lg outline-none transition-colors focus-visible:ring-2";
  return (
    <div className={cn("-ml-1.5 flex items-center gap-0.5 transition-opacity", className)}>
      <button onClick={async () => setCopied(await copyText(text))} className={button} aria-label={copied ? "Copiado" : "Copiar"} title={copied ? "Copiado" : "Copiar"}>
        {copied ? <Check className="text-success size-4" /> : <Copy className="size-4" />}
      </button>
      {canShare && (
        <button onClick={() => navigator.share({ text }).catch(() => undefined)} className={button} aria-label="Compartir" title="Compartir">
          <Share className="size-4" />
        </button>
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copiado" : ""}
      </span>
    </div>
  );
}

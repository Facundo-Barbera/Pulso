"use client";

import type { AgentActionLine, AgentAttachment, AgentMessage, AgentToolResult, AgentToolUse } from "@pulso/contract";
import { AlertTriangle, Check, ChevronDown, ChevronRight, ClipboardList, Copy, Share, Sunrise, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../../_ui/cn";
import { Markdown } from "../../../_ui/markdown";
import { CoachAvatar, copyText, ThinkingDots } from "./bits";
import { photoSrc } from "./photos";
import { ProductCard } from "./product-card";
import { isAction, placeOf, toolLook } from "./tools";

/** Deshacer on tool `index` of a message: null when done, else what went wrong. */
export type UndoAction = (index: number) => Promise<string | null>;

export function MessageRow({ message, last, onUndo }: { message: AgentMessage; last: boolean; onUndo?: UndoAction }) {
  return message.role === "user" ? <UserBubble message={message} /> : <AssistantRow message={message} last={last} onUndo={onUndo} />;
}

function UserBubble({ message }: { message: AgentMessage }) {
  return (
    <div className="flex flex-col items-end gap-1.5 pl-10 motion-safe:animate-[pulso-rise_280ms_ease-out_both] md:pl-20">
      {message.attachments.length > 0 && <Photos photos={message.attachments} />}
      {/* `?.`: messages saved before products existed may come without the field. */}
      {message.products?.length > 0 && (
        <ul className="flex w-[min(280px,100%)] flex-col gap-1.5" aria-label={message.products.length === 1 ? "Producto" : `${message.products.length} productos`}>
          {message.products.map((p) => (
            <li key={p.barcode}>
              <ProductCard item={p} />
            </li>
          ))}
        </ul>
      )}
      {message.text && (
        <div className="group flex items-end justify-end gap-1">
          <Actions text={message.text} className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-md:hidden" />
          <p className="bg-primary text-primary-foreground min-w-0 rounded-[22px] rounded-br-md px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap">{message.text}</p>
        </div>
      )}
    </div>
  );
}

/** What a quoted brief or review is, above its text: the person is answering it. */
function Quoted({ source }: { source: NonNullable<AgentMessage["source"]> }) {
  const Icon = source.kind === "brief" ? Sunrise : ClipboardList;
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-[12.5px] font-medium">
      <Icon className="size-3.5" />
      {source.title}
    </p>
  );
}

/** The person's photos, right-aligned like their bubble; one is big, several make a grid. Click opens it full size. */
function Photos({ photos }: { photos: AgentAttachment[] }) {
  const [open, setOpen] = useState<AgentAttachment | null>(null);
  const single = photos.length === 1;
  return (
    <>
      <ul className={cn("grid gap-1.5", single ? "w-[min(280px,100%)]" : "w-[min(320px,100%)] grid-cols-2")} aria-label={single ? "Foto" : `${photos.length} fotos`}>
        {photos.map((photo, i) => (
          <li key={photo.id} className={cn(!single && photos.length === 3 && i === 0 && "col-span-2")}>
            <button
              type="button"
              onClick={() => setOpen(photo)}
              className="bg-muted focus-visible:ring-ring block w-full overflow-hidden rounded-[18px] outline-none focus-visible:ring-2"
              aria-label={`Ver foto ${i + 1} en grande`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoSrc(photo)}
                alt=""
                loading="lazy"
                decoding="async"
                className={cn("w-full object-cover transition-transform motion-safe:hover:scale-[1.02]", single ? "max-h-[360px]" : "aspect-square")}
                style={single && photo.width && photo.height ? { aspectRatio: `${photo.width} / ${photo.height}` } : undefined}
              />
            </button>
          </li>
        ))}
      </ul>
      {open && <PhotoViewer src={photoSrc(open)} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Full size over everything; Esc, the button or a click outside the photo closes it. */
function PhotoViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      className="m-0 hidden h-dvh max-h-none open:grid w-dvw max-w-none place-items-center bg-transparent p-4 backdrop:bg-black/85 backdrop:backdrop-blur-sm"
      aria-label="Foto"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="max-h-[92dvh] max-w-full rounded-xl object-contain shadow-3 motion-safe:animate-[pulso-rise_200ms_ease-out_both]" />
      <button
        type="button"
        onClick={() => dialog.current?.close()}
        className="focus-visible:ring-ring fixed top-[max(1rem,env(safe-area-inset-top))] right-4 grid size-11 place-items-center rounded-full bg-white/15 text-white outline-none backdrop-blur hover:bg-white/25 focus-visible:ring-2"
        aria-label="Cerrar"
      >
        <X className="size-5" />
      </button>
    </dialog>
  );
}

function AssistantRow({ message, last, onUndo }: { message: AgentMessage; last: boolean; onUndo?: UndoAction }) {
  const streaming = message.status === "streaming";
  const thinking = streaming && !message.text && !message.tools.some((t) => t.status === "running");
  // Lookups that finished fold into one quiet line; what is running (or failed) shows as a chip; what changed something gets a card.
  const checked = message.tools.filter((t) => t.status === "done" && !isAction(t));
  const activity = message.tools.filter((t) => t.status !== "done" || (isAction(t) && !t.result));
  const actions = message.tools.flatMap((t, index) => (t.status === "done" && t.result ? [{ result: t.result, index }] : []));

  return (
    <div className="group/msg flex flex-col gap-3.5 motion-safe:animate-[pulso-rise_280ms_ease-out_both]">
      {message.source && <Quoted source={message.source} />}
      {checked.length > 0 && <Checked tools={checked} />}
      {activity.length > 0 && <ToolChips tools={activity} />}
      {thinking && (
        <div className="flex items-center gap-2.5">
          <CoachAvatar size={28} active />
          <ThinkingDots />
        </div>
      )}
      {message.text && <Markdown text={message.text} className="space-y-3 text-[15.5px] leading-[1.65]" />}
      {actions.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {actions.map(({ result, index }) => (
            <ActionCard key={index} result={result} onUndo={onUndo && result.undo ? () => onUndo(index) : undefined} />
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

/** "Revisó 3 cosas": the lookups behind an answer, folded; open to see which. */
function Checked({ tools }: { tools: AgentToolUse[] }) {
  const labels = [...new Set(tools.map((t) => toolLook(t.name).label))];
  return (
    <details className="group/checked text-muted-foreground text-[13px]">
      <summary className="hover:text-foreground focus-visible:ring-ring inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-full px-1 font-medium outline-none transition-colors focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
        <Check className="text-good size-3.5" strokeWidth={2.4} />
        Revisó {tools.length === 1 ? "1 cosa" : `${tools.length} cosas`}
        <ChevronDown className="size-3.5 transition-transform group-open/checked:rotate-180" />
      </summary>
      <ul className="mt-1 flex flex-wrap gap-1.5 motion-safe:animate-[pulso-rise_200ms_ease-out_both]">
        {labels.map((label) => {
          const look = toolLook(tools.find((t) => toolLook(t.name).label === label)!.name);
          const Icon = look.icon;
          return (
            <li key={label} className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5" style={{ background: `color-mix(in oklab, ${look.color} 8%, transparent)` }}>
              <Icon className="size-3.5 shrink-0" style={{ color: look.color }} strokeWidth={2.2} />
              {label}
            </li>
          );
        })}
      </ul>
    </details>
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

/** "Objetivo: Bajar de peso → Bajar 10 kg de grasa". */
function ActionLine({ line }: { line: AgentActionLine }) {
  return (
    <li className="text-[13.5px] leading-snug break-words">
      {line.label && <span className="text-muted-foreground">{line.label}: </span>}
      {line.before && (
        <>
          <span className="text-muted-foreground line-through decoration-1">{line.before}</span>
          <span className="text-muted-foreground" aria-label=" cambió a ">
            {" → "}
          </span>
        </>
      )}
      <span className="font-medium">{line.value}</span>
    </li>
  );
}

/** What a tool changed: title, before → after, a link to where it lives and Deshacer when it can be undone. */
function ActionCard({ result, onUndo }: { result: AgentToolResult; onUndo?: () => Promise<string | null> }) {
  const place = placeOf(result);
  const Icon = place.icon;
  const lines = result.lines ?? (result.detail ? [{ label: null, before: null, value: result.detail }] : []);
  const undone = result.undo === "done";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mixed toward the text colour so yellows stay readable in light mode.
  const ink = `color-mix(in oklab, ${place.color} 75%, var(--foreground))`;

  const undo = async () => {
    if (!onUndo || busy) return;
    setBusy(true);
    setError(await onUndo());
    setBusy(false);
  };

  return (
    <div
      className={cn("shadow-1 flex flex-col gap-2.5 rounded-2xl p-3.5 transition-opacity motion-safe:animate-[pulso-rise_240ms_ease-out_both]", undone && "opacity-70")}
      style={{ background: `color-mix(in oklab, ${place.color} 7%, var(--card))` }}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in oklab, ${place.color} 18%, transparent)`, color: place.color }}>
          {undone ? <Undo2 className="size-[18px]" strokeWidth={2.2} /> : <Icon className="size-[18px]" strokeWidth={2.2} />}
        </span>
        <span className="min-w-0 flex-1 text-[14px] font-semibold">{result.title}</span>
        {undone && <span className="text-muted-foreground bg-muted shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold">Deshecho</span>}
      </div>
      {lines.length > 0 && (
        <ul className={cn("flex flex-col gap-1 pl-12", undone && "line-through decoration-1")}>
          {lines.map((line, i) => (
            <ActionLine key={i} line={line} />
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1 pl-10">
        <Link
          href={place.href}
          className="hover:bg-muted focus-visible:ring-ring group inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2 text-[12.5px] font-semibold outline-none focus-visible:ring-2"
          style={{ color: ink }}
        >
          Abrir en {place.name}
          <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
        {onUndo && !undone && (
          <button
            type="button"
            onClick={undo}
            disabled={busy}
            className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[12.5px] font-semibold outline-none transition-colors focus-visible:ring-2 disabled:opacity-60"
          >
            <Undo2 className={cn("size-3.5", busy && "motion-safe:animate-pulse")} />
            {busy ? "Deshaciendo…" : "Deshacer"}
          </button>
        )}
      </div>
      {error && (
        <p className="text-warning flex items-start gap-1.5 pl-12 text-[12.5px]" role="alert">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
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
        {copied ? <Check className="text-good size-4" /> : <Copy className="size-4" />}
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

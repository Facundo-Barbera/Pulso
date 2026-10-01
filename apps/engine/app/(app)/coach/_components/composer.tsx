"use client";

import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../../_ui/cn";
import { Glow } from "./bits";

const MAX_HEIGHT = 220;

/** Enter sends, Shift+Enter breaks the line, Esc stops a reply. The draft comes back if nothing was sent. */
export function Composer({ streaming, onSend, onStop, autoFocus, placeholder }: { streaming: boolean; onSend: (text: string) => Promise<boolean>; onStop: () => void; autoFocus?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const canSend = !streaming && draft.trim().length > 0;

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [draft]);

  // On the phone the keyboard would cover the welcome; focus only where there is a real keyboard.
  useEffect(() => {
    if (autoFocus && window.matchMedia("(min-width: 768px) and (pointer: fine)").matches) area.current?.focus();
  }, [autoFocus]);

  async function submit() {
    if (!canSend) return;
    const text = draft;
    setDraft("");
    if (!(await onSend(text))) setDraft((now) => now || text);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="mx-auto w-full max-w-[760px] px-4 md:px-8"
    >
      <Glow active={streaming} radius={24}>
        <div className="bg-card shadow-2 border-border focus-within:border-ring/40 flex items-end gap-2 rounded-[24px] border p-2 pl-4 transition-colors">
          <label htmlFor="coach-composer" className="sr-only">
            Mensaje para el Coach
          </label>
          <textarea
            id="coach-composer"
            ref={area}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              } else if (e.key === "Escape" && streaming) {
                e.preventDefault();
                onStop();
              }
            }}
            placeholder={streaming ? "El Coach está respondiendo…" : (placeholder ?? "Pregúntale a tu Coach…")}
            className="placeholder:text-muted-foreground max-h-[220px] min-h-10 flex-1 resize-none bg-transparent py-2 text-[15.5px] leading-normal outline-none"
            enterKeyHint="send"
          />
          {streaming ? (
            <button type="button" onClick={onStop} className="bg-foreground text-background focus-visible:ring-ring grid size-10 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-offset-2" aria-label="Detener respuesta" title="Detener (Esc)">
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className={cn(
                "focus-visible:ring-ring grid size-10 shrink-0 place-items-center rounded-full outline-none transition-[background-color,transform] focus-visible:ring-2 focus-visible:ring-offset-2 motion-safe:active:scale-95",
                canSend ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
              aria-label="Enviar"
              title="Enviar (Enter)"
            >
              <ArrowUp className="size-[18px]" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </Glow>
      <p className="text-muted-foreground mt-2 hidden text-center text-[11.5px] md:block" aria-hidden>
        {streaming ? "Esc para detener" : "Enter para enviar · Shift + Enter para otra línea"}
      </p>
    </form>
  );
}

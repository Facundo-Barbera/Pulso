"use client";

import { ArrowUp, ImagePlus, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../../_ui/cn";
import { Glow } from "./bits";
import { imageFiles, MAX_PHOTOS, preparePhoto, type Photo } from "./photos";

const MAX_HEIGHT = 220;

/**
 * Enter sends, Shift+Enter breaks the line, Esc stops a reply. Photos come from
 * the button, a paste or a drop anywhere on the page. The draft comes back if nothing was sent.
 */
export function Composer({ streaming, onSend, onStop, autoFocus, placeholder }: { streaming: boolean; onSend: (text: string, photos: Photo[]) => Promise<boolean>; onStop: () => void; autoFocus?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const canSend = !streaming && (draft.trim().length > 0 || photos.length > 0);

  async function addPhotos(files: File[]) {
    if (!files.length) return;
    const room = MAX_PHOTOS - photos.length;
    setNote(files.length > room ? `Hasta ${MAX_PHOTOS} fotos por mensaje.` : null);
    const added = await Promise.all(files.slice(0, Math.max(room, 0)).map(preparePhoto));
    setPhotos((now) => [...now, ...added].slice(0, MAX_PHOTOS));
    area.current?.focus();
  }

  // A photo dropped anywhere on the page lands here instead of the browser opening it.
  const add = useRef(addPhotos);
  add.current = addPhotos;
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const enter = (e: DragEvent) => hasFiles(e) && ++depth && setDragging(true);
    const leave = (e: DragEvent) => hasFiles(e) && --depth <= 0 && ((depth = 0), setDragging(false));
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void add.current(imageFiles(e.dataTransfer?.files));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

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
    const sent = photos;
    setDraft("");
    setPhotos([]);
    setNote(null);
    if (!(await onSend(text, sent))) {
      setDraft((now) => now || text);
      setPhotos((now) => (now.length ? now : sent));
    }
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
        <div className={cn("bg-card shadow-2 border-border focus-within:border-ring/40 rounded-[24px] border p-2 transition-colors", dragging && "border-primary ring-primary/30 ring-4")}>
          {(photos.length > 0 || dragging) && (
            <ul className="flex gap-2 overflow-x-auto px-1 pt-1 pb-2" aria-label="Fotos para enviar">
              {photos.map((photo) => (
                <li key={photo.id} className="relative shrink-0 motion-safe:animate-[pulso-rise_200ms_ease-out_both]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview */}
                  <img src={photo.url} alt="" className="bg-muted size-16 rounded-xl object-cover" />
                  <button
                    type="button"
                    onClick={() => setPhotos((now) => now.filter((p) => p.id !== photo.id))}
                    className="bg-foreground text-background focus-visible:ring-ring absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full shadow-2 outline-none focus-visible:ring-2"
                    aria-label="Quitar foto"
                  >
                    <X className="size-3.5" strokeWidth={2.5} />
                  </button>
                </li>
              ))}
              {dragging && photos.length < MAX_PHOTOS && (
                <li className="border-primary/60 text-primary grid size-16 shrink-0 place-items-center rounded-xl border-2 border-dashed" aria-hidden>
                  <ImagePlus className="size-5" />
                </li>
              )}
            </ul>
          )}
          <div className="flex items-end gap-1">
            <input
              ref={picker}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              hidden
              onChange={(e) => {
                void addPhotos(imageFiles(e.target.files));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={photos.length >= MAX_PHOTOS}
              className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-10 shrink-0 place-items-center rounded-full outline-none transition-colors focus-visible:ring-2 disabled:opacity-40"
              aria-label="Añadir fotos"
              title="Añadir fotos (o pégalas / arrástralas)"
            >
              <ImagePlus className="size-[19px]" />
            </button>
            <label htmlFor="coach-composer" className="sr-only">
              Mensaje para el Coach
            </label>
            <textarea
              id="coach-composer"
              ref={area}
              value={draft}
              rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                const files = imageFiles(e.clipboardData.files);
                if (!files.length) return;
                e.preventDefault();
                void addPhotos(files);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                } else if (e.key === "Escape" && streaming) {
                  e.preventDefault();
                  onStop();
                }
              }}
              placeholder={streaming ? "El Coach está respondiendo…" : photos.length ? "Añade un comentario o envía…" : (placeholder ?? "Pregúntale a tu Coach…")}
              className="placeholder:text-muted-foreground max-h-[220px] min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-[15.5px] leading-normal outline-none"
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
        </div>
      </Glow>
      {note ? (
        <p className="text-warning mt-2 text-center text-[12px]" role="status">
          {note}
        </p>
      ) : (
        <p className="text-muted-foreground mt-2 hidden text-center text-[11.5px] md:block" aria-hidden>
          {streaming ? "Esc para detener" : "Enter para enviar · Shift + Enter para otra línea · pega o arrastra fotos"}
        </p>
      )}
    </form>
  );
}

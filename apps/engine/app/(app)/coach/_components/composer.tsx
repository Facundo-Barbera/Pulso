"use client";

import type { AgentProduct } from "@pulso/contract";
import { ArrowUp, ImagePlus, Plus, ScanBarcode, Square, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../../_ui/cn";
import { Glow } from "./bits";
import { imageFiles, MAX_PHOTOS, preparePhoto, type Photo } from "./photos";
import { ProductCard } from "./product-card";
import { lookupProduct, MAX_PRODUCTS, normalizeBarcode, type DraftProduct } from "./products";

const MAX_HEIGHT = 220;

/**
 * Enter sends, Shift+Enter breaks the line, Esc stops a reply. Photos come from
 * the attach menu, a paste or a drop anywhere on the page; a packaged product
 * from its barcode, typed or pasted. The draft comes back if nothing was sent.
 */
export function Composer({ streaming, onSend, onStop, autoFocus, placeholder }: { streaming: boolean; onSend: (text: string, photos: Photo[], products: AgentProduct[]) => Promise<boolean>; onStop: () => void; autoFocus?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [products, setProducts] = useState<DraftProduct[]>([]);
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const looking = products.some((p) => p.looking);
  const canSend = !streaming && !looking && (draft.trim().length > 0 || photos.length > 0 || products.length > 0);

  function closeScan() {
    setScanning(false);
    setCode("");
    setCodeError(null);
  }

  /** The card goes in at once and fills in when Open Food Facts answers; a code the Mac refuses comes back to the field. */
  async function addProduct() {
    const barcode = normalizeBarcode(code);
    if (!barcode) return setCodeError("El código debe tener de 8 a 14 dígitos.");
    if (products.some((p) => p.barcode === barcode)) return setCodeError("Ese producto ya está en el mensaje.");
    if (products.length >= MAX_PRODUCTS) return setCodeError(`Hasta ${MAX_PRODUCTS} productos por mensaje.`);
    closeScan();
    setProducts((now) => [...now, { barcode, product: null, looking: true, offline: false }]);
    area.current?.focus();
    const found = await lookupProduct(barcode);
    if ("error" in found) {
      setProducts((now) => now.filter((p) => p.barcode !== barcode));
      setScanning(true);
      setCode(barcode);
      setCodeError(found.error);
      return;
    }
    setProducts((now) => now.map((p) => (p.barcode === barcode ? { ...p, ...found, looking: false } : p)));
  }

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
    const scanned = products;
    setDraft("");
    setPhotos([]);
    setProducts([]);
    setNote(null);
    closeScan();
    if (!(await onSend(text, sent, scanned.map(({ barcode, product }) => ({ barcode, product }))))) {
      setDraft((now) => now || text);
      setPhotos((now) => (now.length ? now : sent));
      setProducts((now) => (now.length ? now : scanned));
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
          {products.length > 0 && (
            <ul className="flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Productos para enviar">
              {products.map((p) => (
                <li key={p.barcode} className="shrink-0 pt-1.5 pr-1.5 pb-1 motion-safe:animate-[pulso-rise_200ms_ease-out_both]">
                  <ProductCard item={p} looking={p.looking} offline={p.offline} onRemove={() => setProducts((now) => now.filter((o) => o.barcode !== p.barcode))} className="w-[248px]" />
                </li>
              ))}
            </ul>
          )}
          {scanning && (
            <div className="px-1 pt-1 pb-2 motion-safe:animate-[pulso-rise_180ms_ease-out_both]">
              <div className="flex items-center gap-1.5">
                <label className={cn("bg-muted/60 border-border focus-within:ring-ring flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 focus-within:ring-2 md:h-10", codeError && "border-destructive/60")}>
                  <ScanBarcode className="text-muted-foreground size-4 shrink-0" />
                  <span className="sr-only">Código de barras</span>
                  <input
                    autoFocus
                    value={code}
                    inputMode="numeric"
                    autoComplete="off"
                    enterKeyHint="done"
                    onChange={(e) => {
                      setCode(e.target.value);
                      setCodeError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void addProduct();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        closeScan();
                        area.current?.focus();
                      }
                    }}
                    placeholder="Código de barras · 8 a 14 dígitos"
                    aria-invalid={codeError ? true : undefined}
                    aria-describedby={codeError ? "coach-barcode-error" : undefined}
                    className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[14px] tabular outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void addProduct()}
                  disabled={!code.trim()}
                  className="bg-primary text-primary-foreground focus-visible:ring-ring min-h-11 shrink-0 rounded-full px-4 text-[14px] font-medium outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-40 md:min-h-10"
                >
                  Añadir
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeScan();
                    area.current?.focus();
                  }}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-11 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 md:size-10"
                  aria-label="Cerrar código de barras"
                >
                  <X className="size-4" />
                </button>
              </div>
              {codeError && (
                <p id="coach-barcode-error" className="text-destructive mt-1.5 px-1 text-[12.5px]" role="alert">
                  {codeError}
                </p>
              )}
            </div>
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
            <AttachMenu
              items={[
                { label: "Fotos", icon: ImagePlus, disabled: photos.length >= MAX_PHOTOS, run: () => picker.current?.click() },
                { label: "Código de barras", icon: ScanBarcode, disabled: products.length >= MAX_PRODUCTS, run: () => setScanning(true) },
              ]}
            />
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
              placeholder={streaming ? "El Coach está respondiendo…" : products.length ? "¿Cuánto comiste? «una cucharada», «la mitad»…" : photos.length ? "Añade un comentario o envía…" : (placeholder ?? "Pregúntale a tu Coach…")}
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

type AttachItem = { label: string; icon: LucideIcon; disabled: boolean; run: () => void };

/** «+»: photos or a barcode. Opens upward; closes on a pick, a click outside or Escape. */
function AttachMenu({ items }: { items: AttachItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    root.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Adjuntar"
        title="Adjuntar fotos o un producto"
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-10 place-items-center rounded-full outline-none transition-[background-color,color] focus-visible:ring-2",
          open && "bg-muted text-foreground",
        )}
      >
        <Plus className={cn("size-5 transition-transform", open && "rotate-45")} strokeWidth={2.2} />
      </button>
      {open && (
        <ul role="menu" aria-label="Adjuntar" className="bg-popover text-popover-foreground shadow-3 border-border absolute bottom-full left-0 z-20 mb-2 w-56 rounded-2xl border p-1.5 motion-safe:animate-[pulso-rise_180ms_cubic-bezier(.2,.7,.2,1)_both]">
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
                className="hover:bg-muted focus-visible:bg-muted flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[14px] outline-none disabled:opacity-40 md:min-h-10"
              >
                <item.icon className="text-muted-foreground size-4" />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * A modal sheet: centred on the desktop, rising from the bottom on the phone.
 * A native <dialog>, so focus trapping and Escape come free.
 */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    else if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      aria-label={title}
      className="bg-popover text-popover-foreground shadow-3 border-border backdrop:bg-overlay inset-x-0 bottom-0 mx-auto mt-auto mb-0 max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-[22px] border p-0 backdrop:backdrop-blur-xs open:flex open:flex-col md:m-auto md:w-[min(560px,calc(100vw-48px))] md:rounded-[22px] motion-safe:open:animate-[pulso-rise_260ms_cubic-bezier(.2,.7,.2,1)_both]"
    >
      <header className="flex items-center gap-3 px-5 pt-5 pb-3 md:px-6">
        <h2 className="flex-1 text-[18px] font-semibold tracking-tight">{title}</h2>
        <button onClick={onClose} className="text-muted-foreground hover:bg-muted focus-visible:ring-ring -mr-2 grid size-9 place-items-center rounded-full outline-none focus-visible:ring-2" aria-label="Cerrar">
          <X className="size-[18px]" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 md:px-6">{children}</div>
      {footer && <footer className="border-border flex items-center justify-end gap-2 border-t px-5 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] md:px-6 md:pb-3">{footer}</footer>}
    </dialog>
  );
}

const base = "focus-visible:ring-ring inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-medium outline-none focus-visible:ring-2 disabled:opacity-50 md:min-h-10";
export const buttonPrimary = `${base} bg-primary text-primary-foreground hover:opacity-90 focus-visible:ring-offset-2`;
export const buttonQuiet = `${base} hover:bg-muted text-foreground`;
export const buttonSoft = `${base} bg-muted hover:bg-accent text-foreground`;
export const field =
  "bg-muted/60 border-border focus-visible:ring-ring placeholder:text-muted-foreground h-11 min-w-0 rounded-xl border px-3 text-[14px] outline-none focus-visible:ring-2 md:h-10";

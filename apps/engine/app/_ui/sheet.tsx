"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * A modal for editing one thing: a native <dialog> (focus trap and Escape for
 * free), a title, a scrolling body and a footer for the actions. The body is
 * only mounted while open, so a draft starts fresh every time.
 */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      className="bg-popover text-popover-foreground shadow-3 border-border backdrop:bg-overlay m-auto max-h-[min(88vh,820px)] w-[min(540px,calc(100vw-24px))] overflow-hidden rounded-3xl border p-0 backdrop:backdrop-blur-xs open:flex open:flex-col"
      aria-label={title}
    >
      {open && (
        <>
          <header className="flex shrink-0 items-center gap-3 px-6 pt-5 pb-3">
            <h2 className="flex-1 text-[18px] font-semibold tracking-tight">{title}</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring -mr-2 grid size-10 place-items-center rounded-full outline-none focus-visible:ring-2" aria-label="Cerrar">
              <X className="size-5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>
          {footer && <footer className="border-border flex shrink-0 flex-wrap items-center gap-2 border-t px-6 py-4">{footer}</footer>}
        </>
      )}
    </dialog>
  );
}

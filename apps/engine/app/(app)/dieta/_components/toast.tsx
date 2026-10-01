"use client";

import { Undo2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../../_ui/cn";

/** What a change says back: the engine's Spanish summary and, when it can be taken back, how. */
export type ToastData = { key: number; message: string; tone?: "error"; undo?: () => Promise<boolean> };

const LINGER_MS = 10_000;

type Notify = (toast: Omit<ToastData, "key">) => void;
const ToastContext = createContext<Notify>(() => {});

/** `notify({ message, undo? })` shows the toast; a new one replaces the last. */
export const useToast = () => useContext(ToastContext);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastData | null>(null);
  const notify = useCallback<Notify>((t) => setToast({ ...t, key: Date.now() }), []);
  const done = useCallback(() => setToast(null), []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      {/* On <body>: an animated ancestor would otherwise pin "fixed" to itself. */}
      {toast && createPortal(<Toast toast={toast} onDone={done} />, document.body)}
    </ToastContext.Provider>
  );
}

/**
 * The one line a plan change answers with, floating above the tab bar on the
 * phone and at the bottom of the window on the desktop. «Deshacer» takes the
 * change back; it fades out on its own after a few seconds.
 */
function Toast({ toast, onDone }: { toast: ToastData; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (hover || busy) return;
    const timer = setTimeout(onDone, LINGER_MS);
    return () => clearTimeout(timer);
  }, [toast.key, hover, busy, onDone]);

  async function undo() {
    if (!toast.undo) return;
    setBusy(true);
    await toast.undo();
    setBusy(false);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="pointer-events-none fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-40 flex justify-center px-3 md:bottom-6"
    >
      <div
        key={toast.key}
        className={cn(
          "bg-popover text-popover-foreground shadow-3 border-border pointer-events-auto flex max-w-[min(640px,100%)] items-center gap-3 rounded-2xl border py-2 pr-2 pl-4 motion-safe:animate-[pulso-rise_260ms_cubic-bezier(.2,.7,.2,1)_both]",
          toast.tone === "error" && "border-destructive/40",
        )}
      >
        <p className={cn("min-w-0 flex-1 py-1.5 text-[14px] leading-snug", toast.tone === "error" && "text-destructive")}>{toast.message}</p>
        {toast.undo && (
          <button onClick={undo} disabled={busy} className="text-primary hover:bg-primary/10 focus-visible:ring-ring flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[14px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50">
            <Undo2 className="size-4" />
            Deshacer
          </button>
        )}
        <button onClick={onDone} className="text-muted-foreground hover:bg-muted focus-visible:ring-ring grid size-9 shrink-0 place-items-center rounded-xl outline-none focus-visible:ring-2" aria-label="Cerrar">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

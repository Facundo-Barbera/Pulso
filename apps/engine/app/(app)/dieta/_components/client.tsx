"use client";

import type { FrequentFood } from "@pulso/contract";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useState, useTransition } from "react";
import type { DietaEntry } from "@/src/web/dieta";
import { RegisterSheet } from "./register-sheet";
import { buttonPrimary } from "./sheet";

/** Sends a write to the Dieta API; the error message (Spanish) when it fails. */
export async function send(path: string, method: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  try {
    const response = await fetch(`/api/web/dieta/${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (response.ok) return { ok: true, data };
    if (response.status === 403) return { ok: false, message: "Este navegador sólo puede mirar, no registrar." };
    return { ok: false, message: (data as { message?: string } | null)?.message ?? `Algo falló (${response.status}).` };
  } catch {
    return { ok: false, message: "No hay conexión con la Mac." };
  }
}

/** A write followed by a server refresh, with a pending flag and the last error. */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    (path: string, method: string, body?: unknown) =>
      new Promise<boolean>((resolve) => {
        setError(null);
        startTransition(async () => {
          const result = await send(path, method, body);
          if (!result.ok) setError(result.message);
          else router.refresh();
          resolve(result.ok);
        });
      }),
    [router],
  );
  return { run, pending, error, setError };
}

type Context = {
  date: string;
  isToday: boolean;
  hasPlan: boolean;
  frequent: FrequentFood[];
  register: (entry?: DietaEntry) => void;
};

const DietaContext = createContext<Context | null>(null);

export const useDieta = () => useContext(DietaContext)!;

/** Holds the day being shown and the one «Registrar» sheet every trigger on the page opens. */
export function DietaProvider({ date, isToday, hasPlan, frequent, children }: Omit<Context, "register"> & { children: React.ReactNode }) {
  const [sheet, setSheet] = useState<{ entry?: DietaEntry; key: number } | null>(null);
  const register = useCallback((entry?: DietaEntry) => setSheet({ entry, key: Date.now() }), []);
  return (
    <DietaContext.Provider value={{ date, isToday, hasPlan, frequent, register }}>
      {children}
      {sheet && <RegisterSheet key={sheet.key} entry={sheet.entry} onClose={() => setSheet(null)} />}
    </DietaContext.Provider>
  );
}

/** The page's one primary action. */
export function RegisterButton({ label = "Registrar" }: { label?: string }) {
  const { register } = useDieta();
  return (
    <button onClick={() => register()} className={`${buttonPrimary} app-no-drag shadow-1`}>
      <Plus className="size-4" strokeWidth={2.4} />
      {label}
    </button>
  );
}

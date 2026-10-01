"use client";

import type { PairedDevice } from "@pulso/contract";
import { Laptop, Smartphone, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "../../../_ui/empty-state";
import { fmtAgo, fmtShortDate } from "../../../_ui/format";

/** Every paired phone and browser, with when it was last seen and a revoke. The Mac only. */
export function DeviceList({ devices }: { devices: PairedDevice[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string) {
    setError(null);
    const response = await fetch(`/api/web/admin/devices/${id}`, { method: "DELETE" });
    if (!response.ok) setError(`No se pudo revocar (${response.status}).`);
    setConfirming(null);
    router.refresh();
  }

  if (devices.length === 0) return <EmptyState compact icon={Smartphone} color="var(--domain-body)" title="Nada emparejado todavía" line="Genera un código a la izquierda para el iPhone o para otro navegador." />;

  return (
    <>
      <ul className="-mx-2 space-y-0.5">
        {devices.map((device) => (
          <li key={device.id} className="hover:bg-muted/50 flex min-h-14 items-center gap-3 rounded-xl px-2">
            <span className="bg-muted grid size-9 shrink-0 place-items-center rounded-xl">{device.kind === "phone" ? <Smartphone className="size-[18px]" /> : <Laptop className="size-[18px]" />}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">{device.name}</span>
              {/* Relative time can tick between render and hydration. */}
              <span className="text-muted-foreground block truncate text-[12px]" suppressHydrationWarning>
                {device.kind === "phone" ? "iPhone" : "Navegador"} · {device.lastSeenAt ? `visto ${fmtAgo(device.lastSeenAt)}` : "nunca visto"} · desde el {fmtShortDate(device.pairedAt)}
              </span>
            </span>
            {confirming === device.id ? (
              <span className="flex gap-1.5">
                <button onClick={() => setConfirming(null)} className="hover:bg-muted min-h-9 rounded-lg px-2.5 text-[13px]">
                  Cancelar
                </button>
                <button onClick={() => revoke(device.id)} className="bg-destructive text-background min-h-9 rounded-lg px-2.5 text-[13px] font-medium">
                  Revocar
                </button>
              </span>
            ) : (
              <button onClick={() => setConfirming(device.id)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus-visible:ring-ring grid size-9 place-items-center rounded-lg outline-none focus-visible:ring-2" aria-label={`Revocar ${device.name}`} title="Revocar">
                <Unplug className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-destructive mt-3 text-[13px]">{error}</p>}
    </>
  );
}

/** A paired browser's view of itself, with a way out — a friend's computer, when done. */
export function ThisBrowser({ device }: { device: PairedDevice }) {
  const [sure, setSure] = useState(false);
  async function forget() {
    await fetch("/api/web/me", { method: "DELETE" });
    window.location.assign("/");
  }
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="bg-muted grid size-10 place-items-center rounded-xl">
          <Laptop className="size-5" />
        </span>
        <span>
          <span className="block text-[15px] font-medium">{device.name}</span>
          <span className="text-muted-foreground block text-[12px]">Emparejado el {fmtShortDate(device.pairedAt)}</span>
        </span>
      </div>
      <p className="text-muted-foreground mt-4 text-[13px] leading-relaxed">Si este ordenador no es tuyo, olvídalo al terminar: hará falta un código nuevo para volver a entrar.</p>
      <button onClick={() => (sure ? forget() : setSure(true))} className="border-destructive/40 text-destructive hover:bg-destructive/10 mt-4 min-h-10 rounded-xl border px-4 text-[13px] font-medium">
        {sure ? "Sí, olvidar este navegador" : "Olvidar este navegador"}
      </button>
    </div>
  );
}

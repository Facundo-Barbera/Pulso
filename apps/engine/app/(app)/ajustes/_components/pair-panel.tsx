"use client";

import type { DeviceKind, PairCode } from "@pulso/contract";
import { Copy, Laptop, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "../../../_ui/cn";

/** Mints a code for an iPhone or a browser and shows it with a live countdown and the steps for that kind. The Mac only. */
export function PairPanel() {
  const router = useRouter();
  const [pair, setPair] = useState<PairCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<DeviceKind | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!pair) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pair]);

  // A paired device shows up in the list next to this panel without a manual reload.
  useEffect(() => {
    if (!pair) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [pair, router]);

  async function generate(kind: DeviceKind) {
    setError(null);
    setBusy(kind);
    try {
      const response = await fetch("/api/web/admin/pair-code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) });
      if (!response.ok) throw new Error(String(response.status));
      setPair((await response.json()) as PairCode);
      setNow(Date.now());
    } catch (e) {
      setError(`No se pudo generar el código (${(e as Error).message}).`);
    } finally {
      setBusy(null);
    }
  }

  const left = pair ? Math.max(0, Math.round((pair.expiresAt - now) / 1000)) : 0;
  const expired = pair !== null && left === 0;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5">
        <KindButton kind="browser" icon={Laptop} label="Navegador" hint="Otro ordenador o iPad" active={pair?.kind === "browser"} busy={busy === "browser"} onClick={() => generate("browser")} />
        <KindButton kind="phone" icon={Smartphone} label="iPhone" hint="La app Pulso" active={pair?.kind === "phone"} busy={busy === "phone"} onClick={() => generate("phone")} />
      </div>

      {pair && (
        <div className="bg-muted/60 mt-4 rounded-2xl p-5" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className={cn("tabular font-mono text-[34px] leading-none font-semibold tracking-[0.18em]", expired && "text-muted-foreground line-through")}>
              {pair.code.slice(0, 4)} {pair.code.slice(4)}
            </p>
            <span className={cn("tabular rounded-full px-2.5 py-1 text-[12px] font-medium", expired ? "bg-destructive/12 text-destructive" : "bg-background text-muted-foreground")}>
              {expired ? "Caducado" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
            </span>
          </div>
          <ol className="text-muted-foreground mt-4 list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed">
            {pair.kind === "browser" ? (
              <>
                <li>
                  En el otro dispositivo, abre <Address address={pair.address} />
                </li>
                <li>Escribe este código y un nombre para reconocerlo.</li>
              </>
            ) : (
              <>
                <li>
                  En la app Pulso del iPhone, escribe la dirección <Address address={pair.address} />
                </li>
                <li>Y después este código.</li>
              </>
            )}
            <li>Vale 5 minutos y un solo uso.</li>
          </ol>
          {!pair.address && <p className="text-warning mt-3 text-[13px]">Esta Mac no tiene IP de Tailscale: ningún otro dispositivo podrá llegar hasta que Tailscale esté activo.</p>}
        </div>
      )}
      {!pair && <p className="text-muted-foreground mt-4 text-[13px] leading-relaxed">Los dispositivos llegan por Tailscale (corre <code className="bg-muted rounded px-1 py-0.5">bun run tailnet</code> en la Mac). Cada uno recibe su propia llave y puedes revocarla cuando quieras.</p>}
      {error && <p className="text-destructive mt-3 text-[13px]">{error}</p>}
    </div>
  );
}

function KindButton({ icon: Icon, label, hint, active, busy, onClick }: { kind: DeviceKind; icon: typeof Laptop; label: string; hint: string; active: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={cn(
        "focus-visible:ring-ring flex min-h-16 items-center gap-3 rounded-2xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 disabled:opacity-60",
        active ? "border-primary bg-primary/8" : "border-border hover:bg-muted/60",
      )}
    >
      <span className="bg-primary/12 text-primary grid size-9 shrink-0 place-items-center rounded-xl">
        <Icon className="size-[18px]" />
      </span>
      <span>
        <span className="block text-[14px] font-medium">{busy ? "Generando…" : label}</span>
        <span className="text-muted-foreground block text-[12px]">{hint}</span>
      </span>
    </button>
  );
}

function Address({ address }: { address: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!address) return <span className="text-foreground">la dirección de Tailscale de esta Mac</span>;
  return (
    <button
      onClick={() => navigator.clipboard?.writeText(address).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
      className="bg-background text-foreground hover:bg-accent inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[12px]"
      title="Copiar"
    >
      {address}
      <Copy className="size-3" />
      {copied && <span className="text-good font-sans">copiada</span>}
    </button>
  );
}

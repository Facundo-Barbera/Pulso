"use client";

import type { PairCode } from "@pulso/contract";
import { useState } from "react";

export function PairPhone() {
  const [pair, setPair] = useState<PairCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null);
    const response = await fetch("/api/pair/code", { method: "POST" });
    if (response.ok) setPair(await response.json());
    else setError(`No se pudo generar el código (${response.status}).`);
  }

  return (
    <div className="space-y-2 text-sm">
      <button onClick={generate} className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900">
        Generar código
      </button>
      {pair && (
        <div className="space-y-1">
          <p className="font-mono text-2xl tracking-[0.3em]">{pair.code}</p>
          <p className="text-neutral-500">
            {pair.address ? (
              <>
                Dirección: <span className="font-mono">{pair.address}</span> (corre <code>bun run tailnet</code>). Vale 5 minutos, un uso.
              </>
            ) : (
              "No hay IP de Tailscale en esta Mac: el iPhone no podrá llegar."
            )}
          </p>
        </div>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}

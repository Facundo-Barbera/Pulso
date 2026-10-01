"use client";

import type { AgentProduct } from "@pulso/contract";
import { ScanBarcode, X } from "lucide-react";
import { useState } from "react";
import { cn } from "../../../_ui/cn";
import { Skeleton } from "../../../_ui/skeleton";
import { per100 } from "./products";

/**
 * A scanned product on a message: photo (or a tinted symbol), name, brand and
 * kcal per 100 g/ml. Unknown products show their code. `onRemove` makes it removable.
 */
export function ProductCard({ item, looking, offline, onRemove, className }: { item: AgentProduct; looking?: boolean; offline?: boolean; onRemove?: () => void; className?: string }) {
  const { product } = item;
  const [broken, setBroken] = useState(false);
  const energy = product ? per100(product) : null;
  return (
    <div className={cn("bg-card shadow-1 relative flex min-h-16 items-center gap-3 rounded-2xl p-2.5 pr-3.5", className)} aria-busy={looking || undefined}>
      {product?.imageUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- Open Food Facts' photo, any host
        <img src={product.imageUrl} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="size-11 shrink-0 rounded-xl bg-white object-contain p-0.5" />
      ) : (
        <span className="bg-energy/15 text-energy grid size-11 shrink-0 place-items-center rounded-xl">
          <ScanBarcode className={cn("size-5", looking && "motion-safe:animate-pulse")} strokeWidth={2.2} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        {looking ? (
          <>
            <span className="sr-only">Buscando el producto {item.barcode}…</span>
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="mt-1.5 h-3 w-20" />
          </>
        ) : product ? (
          <>
            <span className="block truncate text-[14px] font-semibold leading-snug">{product.name}</span>
            <span className="text-muted-foreground block truncate text-[12.5px] leading-snug">
              {product.brand && <>{product.brand} · </>}
              <span className="text-energy tabular font-semibold">{energy!.kcal}</span> <span className="tabular">{energy!.base}</span>
            </span>
          </>
        ) : (
          <>
            <span className="block truncate text-[14px] font-semibold leading-snug">Producto desconocido</span>
            <span className="text-muted-foreground block truncate text-[12.5px] leading-snug">
              <span className="tabular">{item.barcode}</span>
              {offline && " · sin conexión con Open Food Facts"}
            </span>
          </>
        )}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="bg-foreground text-background focus-visible:ring-ring absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full shadow-2 outline-none focus-visible:ring-2"
          aria-label={`Quitar ${product?.name ?? "producto"}`}
        >
          <X className="size-3.5" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

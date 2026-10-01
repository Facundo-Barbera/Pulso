import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { listPantry } from "@/src/shopping/pantry";
import { getShoppingList } from "@/src/shopping/store";
import { planHorizonDays } from "@/src/web/dieta-plan";
import { cn } from "../../../_ui/cn";
import { Page, PageHeader } from "../../../_ui/page-header";
import { ToastHost } from "../_components/toast";
import { Pantry } from "./_components/pantry";
import { ShoppingList } from "./_components/shopping-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compras" };

const VIEWS = [
  { key: "lista", label: "Lista", href: "/dieta/compras" },
  { key: "despensa", label: "Despensa", href: "/dieta/compras?vista=despensa" },
] as const;

/** Compras: Lista (what is left to buy for the plan's coming days, by aisle) and Despensa (what is at home). Ticking moves one to the other. */
export default async function Compras({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const view = (await searchParams).vista === "despensa" ? "despensa" : "lista";
  const list = getShoppingList();
  return (
    <ToastHost>
      <Page>
        <PageHeader
          eyebrow={
            <Link href="/dieta" className="hover:text-foreground app-no-drag inline-flex items-center gap-0.5">
              <ChevronLeft className="-ml-1 size-4" />
              Dieta
            </Link>
          }
          title="Compras"
          actions={
            <nav className="bg-muted app-no-drag flex rounded-full p-1" aria-label="Vista">
              {VIEWS.map((v) => (
                <Link
                  key={v.key}
                  href={v.href}
                  scroll={false}
                  aria-current={v.key === view ? "page" : undefined}
                  className={cn(
                    "focus-visible:ring-ring flex min-h-9 items-center rounded-full px-4 text-[13px] font-medium outline-none focus-visible:ring-2",
                    v.key === view ? "bg-card text-foreground shadow-1" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v.label}
                </Link>
              ))}
            </nav>
          }
        />
        {view === "lista" ? <ShoppingList initial={list} horizonDays={planHorizonDays() ?? 7} /> : <Pantry initial={listPantry()} list={list} />}
      </Page>
    </ToastHost>
  );
}

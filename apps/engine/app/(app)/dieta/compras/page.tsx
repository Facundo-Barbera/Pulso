import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { getShoppingList } from "@/src/shopping/store";
import { planHorizonDays } from "@/src/web/dieta-plan";
import { Page, PageHeader } from "../../../_ui/page-header";
import { ToastHost } from "../_components/toast";
import { ShoppingList } from "./_components/shopping-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compras" };

/** Compras: what is left to buy for the plan's coming days, by aisle. */
export default function Compras() {
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
        />
        <ShoppingList initial={getShoppingList()} horizonDays={planHorizonDays() ?? 7} />
      </Page>
    </ToastHost>
  );
}

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { getShoppingList } from "@/src/shopping/store";
import { Page, PageHeader } from "../../../_ui/page-header";
import { ShoppingList } from "./_components/shopping-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lista de compras" };

/** Lista de compras: what to buy for the coming days of the diet plan, by aisle, plus the person's own items. */
export default function Compras() {
  const list = getShoppingList();
  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/dieta" className="hover:text-foreground app-no-drag inline-flex items-center gap-0.5">
            <ChevronLeft className="-ml-1 size-4" />
            Dieta
          </Link>
        }
        title="Lista de compras"
      />
      <ShoppingList initial={list} />
    </Page>
  );
}

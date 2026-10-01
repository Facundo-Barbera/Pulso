import { Page } from "../_ui/page-header";
import { Skeleton } from "../_ui/skeleton";

/** While a section's server data loads: the same frame as Hoy, so nothing jumps when it arrives. */
export default function Loading() {
  return (
    <Page>
      <div className="pt-[calc(env(safe-area-inset-top)+20px)] pb-6 md:pt-[calc(var(--titlebar-height)+12px)] md:pb-8">
        <Skeleton className="mb-3 h-4 w-40" />
        <Skeleton className="h-9 w-64" />
      </div>
      <Skeleton className="h-[248px] rounded-[18px]" />
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[260px] rounded-[18px]" />
        ))}
      </div>
    </Page>
  );
}

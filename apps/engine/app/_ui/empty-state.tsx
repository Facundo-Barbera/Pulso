import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "./cn";

/** Nothing to show yet, designed: a tinted symbol, one line, one action. Never a bare «Todavía nada». */
export function EmptyState({ icon: Icon, color = "var(--primary)", title, line, action, compact = false }: { icon: LucideIcon; color?: string; title: string; line: string; action?: { href: string; label: string }; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center text-center", compact ? "gap-2 py-4" : "gap-3 py-12")}>
      <div className={cn("relative grid place-items-center rounded-2xl", compact ? "size-11" : "size-16")} style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, color }}>
        <Icon className={compact ? "size-5" : "size-7"} strokeWidth={1.8} />
      </div>
      <div>
        <p className={cn("font-semibold tracking-tight", compact ? "text-[14px]" : "text-[17px]")}>{title}</p>
        <p className={cn("text-muted-foreground mx-auto mt-1 max-w-sm leading-relaxed", compact ? "text-[13px]" : "text-[14px]")}>{line}</p>
      </div>
      {action && (
        <Link href={action.href} className="bg-primary text-primary-foreground focus-visible:ring-ring mt-1 inline-flex min-h-10 items-center rounded-full px-4 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-2">
          {action.label}
        </Link>
      )}
    </div>
  );
}

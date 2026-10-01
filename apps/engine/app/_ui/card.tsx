import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "./cn";

/** A raised surface on the canvas: the unit every page is built from. `delay` staggers the entrance (ms). */
export function Card({ className, children, delay = 0, as: Tag = "section" }: { className?: string; children: React.ReactNode; delay?: number; as?: "section" | "div" | "article" }) {
  return (
    <Tag
      className={cn("bg-card text-card-foreground shadow-1 rounded-[18px] p-5 motion-safe:animate-[pulso-rise_420ms_cubic-bezier(.2,.7,.2,1)_both] md:p-6", className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

/** A card's title row: a tinted icon, the title and an optional link on the right. */
export function CardTitle({ icon: Icon, color, title, href, action }: { icon?: LucideIcon; color?: string; title: string; href?: string; action?: string }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      {Icon && (
        <span className="grid size-7 place-items-center rounded-lg" style={{ background: `color-mix(in oklab, ${color ?? "var(--primary)"} 16%, transparent)`, color: color ?? "var(--primary)" }}>
          <Icon className="size-4" strokeWidth={2.2} />
        </span>
      )}
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {href && (
        <Link href={href} className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -mr-1.5 ml-auto flex min-h-8 items-center gap-0.5 rounded-md px-1.5 text-[13px] outline-none focus-visible:ring-2">
          {action ?? "Ver"}
          <ChevronRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

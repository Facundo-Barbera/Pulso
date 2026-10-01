import type { CalendarItem } from "@pulso/contract";
import { Check, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { CalendarDay } from "@/src/web/calendar";
import { cn } from "../../../_ui/cn";
import { AddBusyOn, EditItem } from "./editors";
import { COLOR, condense, hasConflict, HEALTH_STATUS, hrefOf, ICON, PLAN_STATUS, timeOf } from "./style";

const weekday = new Intl.DateTimeFormat("es", { weekday: "short" });
const longDay = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" });
const noon = (date: string) => new Date(`${date}T12:00:00`);

/** One item: a colour rail, its time, title and subtitle. Opens its section, or its editor for busy time and health. */
export function ItemRow({ item, compact = false }: { item: CalendarItem; compact?: boolean }) {
  const color = COLOR[item.color];
  const Icon = ICON[item.kind];
  const conflict = hasConflict(item);
  const faded = item.kind === "training" && (item.status === "skipped" || item.status === "missed");
  const planned = (item.kind === "training" && (item.status === "planned" || item.status === "moved")) || item.kind === "meal_time";
  const time = item.allDay ? null : item.kind === "sleep" ? `${timeOf(item.start)}–${timeOf(item.end)}` : timeOf(item.start);
  const status = item.kind === "training" ? PLAN_STATUS[item.status ?? ""] : item.kind === "health" ? HEALTH_STATUS[item.status ?? ""] : null;

  const body = (
    <>
      {/* Dashed while still a plan, solid once it happened. */}
      <span className="w-[3px] shrink-0 self-stretch rounded-full" style={{ background: planned ? `repeating-linear-gradient(to bottom, ${color} 0 4px, transparent 4px 7px)` : color }} />
      <span className="min-w-0 flex-1">
        <span className={cn("flex items-center gap-1.5", compact ? "text-[12px]" : "text-[14px]")}>
          {!compact && <Icon className="size-3.5 shrink-0" style={{ color }} />}
          {time && <span className="tabular text-muted-foreground shrink-0">{time}</span>}
          <span className={cn("truncate font-medium", faded && "text-muted-foreground line-through decoration-1")}>{item.title}</span>
          {item.kind === "training" && item.status === "done" && <Check className="text-success size-3.5 shrink-0" strokeWidth={3} />}
          {conflict && <TriangleAlert className="text-warning size-3.5 shrink-0" />}
        </span>
        {(item.subtitle || (!compact && status)) && (
          <span className={cn("block truncate", compact ? "text-[11px]" : "text-[12px]", conflict ? "text-warning" : "text-muted-foreground")}>
            {[!compact && status, item.subtitle].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
    </>
  );

  const className = cn(
    "focus-visible:ring-ring flex w-full items-stretch gap-2 rounded-lg text-left outline-none focus-visible:ring-2 hover:bg-muted/70",
    compact ? "px-1.5 py-1" : "min-h-12 px-2 py-1.5",
    item.kind === "busy" && "bg-muted/50",
    item.kind === "health" && "bg-[color-mix(in_oklab,var(--domain-heart)_9%,transparent)]",
  );
  const href = hrefOf(item);
  if (href) return <Link href={href} className={className}>{body}</Link>;
  return (
    <EditItem kind={item.kind as "busy" | "health"} id={item.link.id} className={className} label={`Editar ${item.title}`}>
      {body}
    </EditItem>
  );
}

/** Monday to Sunday: seven columns on wide screens, one row per day below. */
export function WeekGrid({ days, today }: { days: CalendarDay[]; today: string }) {
  return (
    <div className="bg-card shadow-1 grid overflow-hidden rounded-[18px] motion-safe:animate-[pulso-rise_420ms_cubic-bezier(.2,.7,.2,1)_both] lg:grid-cols-7">
      {days.map((day, i) => {
        const isToday = day.date === today;
        const items = condense(day.items);
        return (
          <section key={day.date} className={cn("group border-border flex min-w-0 flex-col gap-1 p-2.5 max-lg:flex-row max-lg:gap-3 max-lg:px-4 max-lg:py-3 lg:min-h-[420px]", i > 0 && "max-lg:border-t lg:border-l", day.date < today && "bg-muted/25")} aria-label={longDay.format(noon(day.date))}>
            <header className="flex items-center gap-1.5 px-1 pb-1.5 max-lg:w-16 max-lg:shrink-0 max-lg:flex-col max-lg:items-start max-lg:gap-0">
              <span className={cn("text-[12px] font-medium uppercase", isToday ? "text-primary" : "text-muted-foreground")}>{weekday.format(noon(day.date)).replace(".", "")}</span>
              <span className={cn("tabular grid size-7 place-items-center rounded-full text-[15px] font-semibold", isToday && "bg-primary text-primary-foreground")}>{Number(day.date.slice(8))}</span>
              {day.date >= today && <AddBusyOn date={day.date} className="ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-lg:hidden" />}
            </header>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {items.length === 0 ? <p className="text-muted-foreground/70 px-1.5 py-1 text-[12px]">Libre</p> : items.map((item) => <ItemRow key={item.id} item={item} compact />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Six weeks around a month: dots for what happened, each day a link that selects it. */
export function MonthGrid({ days, month, day, today }: { days: CalendarDay[]; month: string; day: string; today: string }) {
  return (
    <div className="bg-card shadow-1 rounded-[18px] p-3 motion-safe:animate-[pulso-rise_420ms_cubic-bezier(.2,.7,.2,1)_both] md:p-4">
      <div className="text-muted-foreground grid grid-cols-7 pb-2 text-center text-[12px] font-medium">
        {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const colors = [...new Set(d.items.map((i) => i.color))];
          const outside = d.date.slice(0, 7) !== month;
          const selected = d.date === day;
          const isToday = d.date === today;
          const warn = d.items.some(hasConflict);
          return (
            <Link
              key={d.date}
              href={`/calendario?vista=mes&dia=${d.date}`}
              scroll={false}
              aria-current={selected ? "date" : undefined}
              aria-label={`${longDay.format(noon(d.date))}: ${d.items.length} ${d.items.length === 1 ? "cosa" : "cosas"}`}
              className={cn(
                "focus-visible:ring-ring flex aspect-square min-h-12 flex-col items-center justify-center gap-1 rounded-xl outline-none focus-visible:ring-2 md:aspect-[4/3]",
                selected ? "bg-accent shadow-1" : "hover:bg-muted/60",
                outside && "opacity-40",
              )}
            >
              <span className={cn("tabular grid size-7 place-items-center rounded-full text-[14px] font-medium", isToday && "bg-primary text-primary-foreground font-semibold")}>{Number(d.date.slice(8))}</span>
              <span className="flex h-1.5 items-center gap-0.5">
                {colors.slice(0, 5).map((c) => (
                  <span key={c} className="size-1.5 rounded-full" style={{ background: COLOR[c] }} />
                ))}
                {warn && <span className="bg-warning size-1.5 rounded-full" />}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Every item of one day, in full. */
export function DayList({ day }: { day: CalendarDay }) {
  if (day.items.length === 0) return <p className="text-muted-foreground py-6 text-center text-[14px]">Día libre: nada registrado ni planificado.</p>;
  return (
    <ul className="-mx-2 space-y-1">
      {day.items.map((item) => (
        <li key={item.id}>
          <ItemRow item={item} />
        </li>
      ))}
    </ul>
  );
}

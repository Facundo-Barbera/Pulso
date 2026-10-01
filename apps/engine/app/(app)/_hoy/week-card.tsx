import { CalendarDays, Check } from "lucide-react";
import Link from "next/link";
import type { WeekStrip } from "@/src/web/calendar";
import { Card, CardTitle } from "../../_ui/card";
import { cn } from "../../_ui/cn";
import { COLOR, hasConflict, timeOf } from "../calendario/_components/style";

const letter = new Intl.DateTimeFormat("es", { weekday: "narrow" });

/** This week at a glance: a dot per kind of thing each day, and what comes next today and tomorrow. */
export function WeekCard({ week, delay }: { week: WeekStrip; delay: number }) {
  return (
    <Card delay={delay} className="md:col-span-2 xl:col-span-3">
      <CardTitle icon={CalendarDays} color="var(--domain-fat)" title="Esta semana" href="/calendario" action="Calendario" />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr] lg:gap-6">
        <ol className="grid grid-cols-7 gap-1">
          {week.days.map((d) => {
            const isToday = d.date === week.today;
            const colors = [...new Set(d.items.map((i) => i.color))];
            const trained = d.items.some((i) => i.kind === "training" && i.status === "done");
            return (
              <li key={d.date}>
                <Link href={`/calendario?vista=mes&dia=${d.date}`} className={cn("focus-visible:ring-ring flex min-h-[72px] flex-col items-center gap-1.5 rounded-xl py-2 outline-none focus-visible:ring-2", isToday ? "bg-muted/80" : "hover:bg-muted/50", d.date < week.today && "opacity-60")}>
                  <span className="text-muted-foreground text-[11px] font-medium uppercase">{letter.format(new Date(`${d.date}T12:00:00`))}</span>
                  <span className={cn("tabular grid size-7 place-items-center rounded-full text-[14px] font-semibold", isToday && "bg-primary text-primary-foreground")}>{Number(d.date.slice(8))}</span>
                  <span className="flex h-2 items-center gap-0.5">
                    {trained ? <Check className="size-3" style={{ color: "var(--domain-training)" }} strokeWidth={3} /> : colors.slice(0, 3).map((c) => <span key={c} className="size-1.5 rounded-full" style={{ background: COLOR[c] }} />)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
        <div className="border-border border-t pt-3 lg:border-t-0 lg:border-l lg:pt-1 lg:pl-6">
          <p className="text-muted-foreground mb-2 text-[12px] font-medium">Lo próximo</p>
          {week.upcoming.length === 0 ? (
            <p className="text-muted-foreground text-[13px]">Nada más planificado para hoy ni mañana.</p>
          ) : (
            <ul className="space-y-2">
              {week.upcoming.map((item) => (
                <li key={item.id} className="flex items-center gap-2.5 text-[13px]">
                  <span className="h-7 w-[3px] shrink-0 rounded-full" style={{ background: COLOR[item.color] }} />
                  <span className="text-muted-foreground tabular shrink-0">{item.allDay ? "Hoy" : `${item.date === week.today ? "" : "Mañana "}${timeOf(item.start)}`}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{item.title}</span>
                    {item.subtitle && <span className={hasConflict(item) ? "text-warning" : "text-muted-foreground"}> · {item.subtitle}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

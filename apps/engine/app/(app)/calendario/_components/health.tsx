import type { HealthEvent } from "@pulso/contract";
import { HeartPulse, History } from "lucide-react";
import { AREA_NAMES } from "@/src/calendar/planner";
import { daysBetween } from "@/src/calendar/time";
import { Card, CardTitle } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { EmptyState } from "../../../_ui/empty-state";
import { AddHealthButton, EditHealthRow } from "./editors";
import { HEALTH_STATUS } from "./style";

const HEART = "var(--domain-heart)";
const KIND: Record<HealthEvent["kind"], string> = { lesion: "Lesión", enfermedad: "Enfermedad", sintoma: "Síntoma", cirugia: "Cirugía", otro: "Otro" };
const dayMonth = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" });
const fmt = (date: string) => dayMonth.format(new Date(`${date}T12:00:00`));

function Severity({ value }: { value: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`Intensidad ${value} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className="size-1.5 rounded-full" style={{ background: n <= value ? HEART : "var(--muted)" }} />
      ))}
    </span>
  );
}

function EventRow({ event, today }: { event: HealthEvent; today: string }) {
  const ongoing = event.status !== "resuelta";
  const days = daysBetween(event.startDate, event.endDate ?? today) + 1;
  const where = event.bodyArea ? AREA_NAMES[event.bodyArea] : null;
  return (
    <EditHealthRow event={event} className="flex items-start gap-3 px-2 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${HEART} ${ongoing ? 16 : 8}%, transparent)`, color: HEART, opacity: ongoing ? 1 : 0.6 }}>
        <HeartPulse className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-medium">{event.title}</span>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", event.status === "activa" ? "text-destructive bg-destructive/10" : event.status === "recuperandose" ? "text-warning bg-warning/12" : "text-muted-foreground bg-muted")}>{HEALTH_STATUS[event.status]}</span>
        </span>
        <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px]">
          {[KIND[event.kind], where].filter(Boolean).join(" · ")}
          <Severity value={event.severity} />
          <span>
            {ongoing ? `desde el ${fmt(event.startDate)} · ${days} ${days === 1 ? "día" : "días"}` : `${fmt(event.startDate)} – ${fmt(event.endDate ?? event.startDate)}`}
          </span>
        </span>
        {event.affectedTraining && <span className="mt-1 block text-[13px]">{event.affectedTraining}</span>}
      </span>
    </EditHealthRow>
  );
}

/** «Salud»: what is going on now, then the history by year. */
export function HealthView({ events, today }: { events: HealthEvent[]; today: string }) {
  const now = events.filter((e) => e.status !== "resuelta");
  const past = events.filter((e) => e.status === "resuelta");
  const years = [...new Set(past.map((e) => e.startDate.slice(0, 4)))];

  if (events.length === 0)
    return (
      <Card>
        <EmptyState icon={HeartPulse} color={HEART} title="Sin lesiones ni enfermedades" line="Si algo te duele o te pones enfermo, anótalo: el plan de entreno lo esquiva y el Coach lo tiene en cuenta." />
        <div className="-mt-6 flex justify-center pb-6">
          <AddHealthButton prominent />
        </div>
      </Card>
    );

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardTitle icon={HeartPulse} color={HEART} title="Ahora" />
        {now.length === 0 ? (
          <EmptyState compact icon={HeartPulse} color={HEART} title="Nada activo" line="Todo lo que anotaste está resuelto." />
        ) : (
          <ul className="-mx-2">
            {now.map((e) => (
              <li key={e.id}>
                <EventRow event={e} today={today} />
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground mt-4 text-[12px] leading-relaxed">Mientras está activa, una lesión fuerte saca del plan los días que la cargan, y una enfermedad, el día entero.</p>
      </Card>
      <Card delay={60}>
        <CardTitle icon={History} color={HEART} title="Historial" />
        {past.length === 0 ? (
          <EmptyState compact icon={History} color={HEART} title="Sin historial" line="Lo que marques como resuelto queda aquí." />
        ) : (
          years.map((year) => (
            <section key={year} className="mb-3 last:mb-0">
              <h3 className="text-muted-foreground text-[12px] font-semibold tracking-wide">{year}</h3>
              <ul className="-mx-2">
                {past
                  .filter((e) => e.startDate.startsWith(year))
                  .map((e) => (
                    <li key={e.id}>
                      <EventRow event={e} today={today} />
                    </li>
                  ))}
              </ul>
            </section>
          ))
        )}
      </Card>
    </div>
  );
}

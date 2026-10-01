import type { CalendarPreferences, PlannedSession } from "@pulso/contract";
import { CalendarClock, ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { AREA_NAMES } from "@/src/calendar/planner";
import { addDays } from "@/src/calendar/time";
import { calendarPage, type CalendarView } from "@/src/web/calendar";
import { Card, CardTitle } from "../../_ui/card";
import { cn } from "../../_ui/cn";
import { Page, PageHeader } from "../../_ui/page-header";
import { DayList, MonthGrid, WeekGrid } from "./_components/agenda";
import { AddMenu, CalendarProvider, EditPreferencesButton, ReplanBanner, type Area } from "./_components/editors";
import { HealthView } from "./_components/health";
import { COLOR, LEGEND, weekdayList } from "./_components/style";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendario" };

const shortDate = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" });
const monthYear = new Intl.DateTimeFormat("es", { month: "long", year: "numeric" });
const longDay = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" });
const noon = (date: string) => new Date(`${date}T12:00:00`);

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mes" },
  { value: "salud", label: "Salud" },
];

// Joints and the whole body first, then muscles, as the body map names them.
const AREAS: Area[] = Object.entries(AREA_NAMES).map(([value, label]) => ({ value, label: value === "general" ? "Todo el cuerpo" : label.charAt(0).toUpperCase() + label.slice(1) }));

const href = (view: CalendarView, day?: string) => `/calendario?vista=${view}${day ? `&dia=${day}` : ""}`;

/** Calendario: the week (or month) with everything Pulso knows, busy time and health events to edit, and how training was re-planned around them. */
export default async function Calendario({ searchParams }: { searchParams: Promise<{ vista?: string; dia?: string }> }) {
  const { vista, dia } = await searchParams;
  const page = calendarPage({ view: vista, day: dia });
  const { view, day, today, from, to } = page;
  const month = day.slice(0, 7);
  const selected = page.days.find((d) => d.date === day);

  const eyebrow = view === "semana" ? `${shortDate.format(noon(from))} – ${shortDate.format(noon(to))}` : view === "mes" ? monthYear.format(noon(day)) : "Lesiones y enfermedades";
  const prev = view === "semana" ? addDays(from, -7) : `${addDays(`${month}-01`, -1).slice(0, 7)}-01`;
  const next = view === "semana" ? addDays(from, 7) : `${addDays(`${month}-28`, 7).slice(0, 7)}-01`;
  const showsToday = view === "semana" ? today >= from && today <= to : month === today.slice(0, 7);

  return (
    <CalendarProvider today={today} day={day} busyBlocks={page.busyBlocks} healthEvents={page.healthEvents} preferences={page.preferences} areas={AREAS}>
      <Page>
        <PageHeader
          eyebrow={eyebrow}
          title="Calendario"
          actions={
            <>
              {view !== "salud" && (
                <nav className="app-no-drag flex items-center gap-1" aria-label="Otras fechas">
                  {!showsToday && (
                    <Link href={href(view)} className="text-muted-foreground hover:text-foreground hover:bg-muted mr-1 flex min-h-10 items-center rounded-full px-3 text-[13px] font-medium">
                      Hoy
                    </Link>
                  )}
                  <Link href={href(view, prev)} className="bg-card shadow-1 hover:bg-accent grid size-10 place-items-center rounded-full" aria-label={view === "semana" ? "Semana anterior" : "Mes anterior"}>
                    <ChevronLeft className="size-4" />
                  </Link>
                  <Link href={href(view, next)} className="bg-card shadow-1 hover:bg-accent grid size-10 place-items-center rounded-full" aria-label={view === "semana" ? "Semana siguiente" : "Mes siguiente"}>
                    <ChevronRight className="size-4" />
                  </Link>
                </nav>
              )}
              <AddMenu />
            </>
          }
        />
        <nav className="bg-muted/70 mb-5 inline-flex rounded-full p-1" aria-label="Vista">
          {VIEWS.map((v) => (
            <Link
              key={v.value}
              href={href(v.value, v.value === "salud" || day === today ? undefined : day)}
              aria-current={view === v.value ? "page" : undefined}
              className={cn("focus-visible:ring-ring flex min-h-9 items-center rounded-full px-4 text-[13px] font-medium outline-none focus-visible:ring-2", view === v.value ? "bg-card text-foreground shadow-1" : "text-muted-foreground hover:text-foreground")}
            >
              {v.label}
            </Link>
          ))}
        </nav>

        <ReplanBanner />

        {view === "salud" ? (
          <HealthView events={page.healthEvents} today={today} />
        ) : (
          <>
            {view === "semana" ? (
              <WeekGrid days={page.days} today={today} />
            ) : (
              <div className="grid items-start gap-5 xl:grid-cols-[1.35fr_1fr]">
                <MonthGrid days={page.days} month={month} day={day} today={today} />
                <Card delay={60}>
                  <h2 className="mb-3 text-[17px] font-semibold tracking-tight first-letter:uppercase">{longDay.format(noon(day))}</h2>
                  {selected && <DayList day={selected} />}
                </Card>
              </div>
            )}
            <Legend />
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              {page.conflicts.length > 0 && <ConflictsCard conflicts={page.conflicts} />}
              <AvailabilityCard preferences={page.preferences} delay={page.conflicts.length ? 110 : 60} />
            </div>
          </>
        )}
      </Page>
    </CalendarProvider>
  );
}

function Legend() {
  return (
    <ul className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[12px]" aria-label="Leyenda">
      {LEGEND.map((l) => (
        <li key={l.color} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: COLOR[l.color] }} />
          {l.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="h-2.5 w-[3px] rounded-full" style={{ background: "repeating-linear-gradient(to bottom, var(--muted-foreground) 0 3px, transparent 3px 5px)" }} />
        Previsto
      </li>
    </ul>
  );
}

function ConflictsCard({ conflicts }: { conflicts: PlannedSession[] }) {
  return (
    <Card delay={60}>
      <CardTitle icon={TriangleAlert} color="var(--warning)" title="Por resolver" href="/coach" action="Preguntar al Coach" />
      <ul className="space-y-3">
        {conflicts.map((c) => (
          <li key={c.id} className="text-[14px]">
            <p>
              <span className="font-medium">{c.name}</span>
              <span className="text-muted-foreground">
                {" "}
                · {longDay.format(noon(c.date))}, {c.time}
              </span>
            </p>
            <p className="text-warning text-[13px]">{c.conflict}</p>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-4 text-[12px] leading-relaxed">No había un hueco libre cerca para moverlas solas.</p>
    </Card>
  );
}

function AvailabilityCard({ preferences: p, delay }: { preferences: CalendarPreferences; delay: number }) {
  const rows: [string, string][] = [
    ["Entrenas", p.trainingTimes.length ? `a las ${p.trainingTimes.join(" o ")}` : "en cualquier hueco libre"],
    ["Sesiones de", `${p.sessionMinutes} min`],
    ["Descansas", p.restDays.length ? `los ${weekdayList(p.restDays)}` : "ningún día fijo"],
    ["Tu día", `de ${p.wakeTime} a ${p.sleepTime}`],
    ["Comidas", p.mealTimes.length ? p.mealTimes.map((m) => m.time).join(" · ") : "sin horas fijas"],
  ];
  return (
    <Card delay={delay}>
      <div className="flex items-start">
        <div className="flex-1">
          <CardTitle icon={CalendarClock} color="var(--domain-training)" title="Disponibilidad" />
        </div>
        <EditPreferencesButton />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground mt-4 text-[12px] leading-relaxed">El plan de entreno se coloca dentro de esto y se mueve solo cuando marcas algo ocupado.</p>
    </Card>
  );
}

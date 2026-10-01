import { ChevronLeft, ChevronRight, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { addDays, localDate } from "@/src/nutrition/dates";
import { dietaDay, dietaProgress } from "@/src/web/dieta";
import { dietaDaySlots, dietaLivingPlan } from "@/src/web/dieta-plan";
import { cn } from "../../_ui/cn";
import { fmtLongDate } from "../../_ui/format";
import { Page, PageHeader } from "../../_ui/page-header";
import { DietaProvider, RegisterButton } from "./_components/client";
import { MacroHero, Timeline, TodayPlan, WeekCard } from "./_components/hoy";
import { LivingPlanView, NoPlan } from "./_components/plan";
import { ProgressView } from "./_components/progress";
import { WaterCard } from "./_components/water-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dieta" };

const VIEWS = [
  { key: "hoy", label: "Día" },
  { key: "plan", label: "Plan" },
  { key: "progreso", label: "Progreso" },
] as const;
type View = (typeof VIEWS)[number]["key"];

type Params = { dia?: string; vista?: string };

function href(p: { dia?: string; vista?: View }, today: string) {
  const q = new URLSearchParams();
  if (p.dia && p.dia !== today) q.set("dia", p.dia);
  if (p.vista && p.vista !== "hoy") q.set("vista", p.vista);
  const s = q.toString();
  return s ? `/dieta?${s}` : "/dieta";
}

function dayTitle(date: string, today: string) {
  if (date === today) return "Hoy";
  if (date === addDays(today, -1)) return "Ayer";
  return new Intl.DateTimeFormat("es", { weekday: "long" }).format(new Date(`${date}T12:00:00`));
}

/** Dieta: the day (macros hero, one Planeado → Real list of its meals and extras — or the timeline of what was logged without a plan — water), the plan's coming days and two weeks of progress. One primary action: Registrar. */
export default async function Dieta({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const today = localDate();
  const date = params.dia && /^\d{4}-\d{2}-\d{2}$/.test(params.dia) && params.dia <= today ? params.dia : today;
  const view: View = VIEWS.some((v) => v.key === params.vista) ? (params.vista as View) : "hoy";
  const day = dietaDay(date, today);
  const progress = dietaProgress(today);
  const slots = view === "hoy" ? dietaDaySlots(date, today) : null;
  const living = view === "plan" ? dietaLivingPlan(today) : null;
  const next = date === today ? (slots?.slots.find((s) => s.status === "planned") ?? null) : null;

  const arrow = "text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-10 place-items-center rounded-full outline-none focus-visible:ring-2";

  return (
    <DietaProvider date={date} isToday={date === today} hasPlan={day.plan !== null} frequent={day.frequent} dishes={day.dishes}>
      <Page>
        <PageHeader
          eyebrow={fmtLongDate(new Date(`${date}T12:00:00`))}
          title="Dieta"
          actions={
            <>
              <Link href="/dieta/compras" className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring app-no-drag flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium outline-none focus-visible:ring-2" title="Compras">
                <ShoppingCart className="size-4" />
                <span className="hidden sm:inline">Compras</span>
              </Link>
              <RegisterButton />
            </>
          }
        />

        <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-3">
          {view === "hoy" && (
            <div className="flex items-center">
              <Link href={href({ dia: addDays(date, -1), vista: view }, today)} className={arrow} aria-label="Día anterior" scroll={false}>
                <ChevronLeft className="size-[18px]" />
              </Link>
              <Link href={href({ vista: view }, today)} className={cn("min-w-16 rounded-lg px-1 sm:min-w-24 text-center text-[15px] font-semibold first-letter:uppercase", date === today && "pointer-events-none")} title={date === today ? undefined : "Volver a hoy"} scroll={false}>
                {dayTitle(date, today)}
              </Link>
              {date < today ? (
                <Link href={href({ dia: addDays(date, 1), vista: view }, today)} className={arrow} aria-label="Día siguiente" scroll={false}>
                  <ChevronRight className="size-[18px]" />
                </Link>
              ) : (
                <span className={cn(arrow, "pointer-events-none opacity-30")} aria-hidden>
                  <ChevronRight className="size-[18px]" />
                </span>
              )}
            </div>
          )}
          <nav className="bg-muted ml-auto flex rounded-full p-1" aria-label="Vista">
            {VIEWS.map((v) => (
              <Link
                key={v.key}
                href={href({ dia: date, vista: v.key }, today)}
                scroll={false}
                aria-current={v.key === view ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-ring flex min-h-9 items-center rounded-full px-3 text-[13px] sm:px-4 font-medium outline-none focus-visible:ring-2",
                  v.key === view ? "bg-card text-foreground shadow-1" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v.key === "hoy" ? (date === today ? "Hoy" : "Día") : v.label}
              </Link>
            ))}
          </nav>
        </div>

        {view === "hoy" && (
          <>
            <MacroHero summary={day.summary} next={next} />
            <div className="mt-5 grid items-start gap-5 md:grid-cols-2 xl:grid-flow-dense xl:grid-cols-3">
              {slots && slots.slots.length > 0 ? (
                <TodayPlan day={slots} recipes={slots.recipes} entries={day.moments.flatMap((m) => m.entries)} title={date === today ? "Hoy" : "El día"} className="md:col-span-2 md:row-span-2" delay={40} />
              ) : (
                <Timeline day={day} className="md:col-span-2 md:row-span-2" delay={60} />
              )}
              <WaterCard water={day.water} delay={110} />
              <WeekCard progress={progress} href={href({ vista: "progreso" }, today)} delay={160} />
            </div>
          </>
        )}
        {view === "plan" && (living ? <LivingPlanView plan={living} /> : <NoPlan />)}
        {view === "progreso" && <ProgressView progress={progress} />}
      </Page>
    </DietaProvider>
  );
}

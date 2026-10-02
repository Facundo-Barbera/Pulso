import type { DailySummary, MealSlot, NutrientZone } from "@pulso/contract";
import { BarChart3, ClipboardList, Clock, Coffee, Cookie, CupSoda, Moon, Sandwich, Sunrise, Utensils, UtensilsCrossed, Wine, Zap, type LucideIcon } from "lucide-react";
import type { DietaDay, DietaEntry, DietaProgress, Moment } from "@/src/web/dieta";
import type { DietaLivingPlan, DayView, SlotView } from "@/src/web/dieta-plan";
import { Card, CardTitle } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { EmptyState } from "../../../_ui/empty-state";
import { fmtDayLabel, fmtNumber } from "../../../_ui/format";
import { Ring } from "../../../_ui/ring";
import { Sparkline } from "../../../_ui/sparkline";
import { EmptyDayActions, EntryActions } from "./actions";
import { byDish, DishRow } from "./dish";
import { PrepChip } from "./prep-chip";
import { EatButton } from "./slot-row";
import { SlotList } from "./slot-sheet";
import { fmtAmount } from "./units";
import { zoneLine, zoneRange, zoneTone } from "./zone";
import { ZoneRing } from "./zone-ring";

const ENERGY = "var(--domain-energy)";
const MACROS = [
  { key: "protein", label: "Proteína", color: "var(--domain-protein)" },
  { key: "carbs", label: "Carbos", color: "var(--domain-carbs)" },
  { key: "fat", label: "Grasa", color: "var(--domain-fat)" },
] as const;

export const SLOT_ICONS: Record<MealSlot, LucideIcon> = {
  desayuno: Sunrise,
  media_manana: Coffee,
  comida: Utensils,
  merienda: Cookie,
  cena: Moon,
  snack: Sandwich,
};

/**
 * The hero: kcal in the big ring, the three macros beside it, and what comes next
 * in the plan. Each ring shows its target zone (see ZoneRing) and says in words
 * how far from it the day is.
 */
export function MacroHero({ summary, next }: { summary: DailySummary; next: SlotView | null }) {
  const { totals, zones } = summary;
  const tone = zones ? zoneTone(zones.kcal, ENERGY) : ENERGY;
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full opacity-[0.10] blur-3xl transition-colors duration-500" style={{ background: tone }} aria-hidden />
      <div className="relative flex flex-col items-center gap-6 md:flex-row md:items-center md:gap-10">
        {zones ? (
          <ZoneRing zone={zones.kcal} size={184} stroke={15} color={ENERGY} glow label={`${fmtNumber(totals.kcal)} kcal. ${zoneLine(zones.kcal, "kcal")}. Zona: ${zoneRange(zones.kcal, "kcal")}, objetivo ${fmtNumber(zones.kcal.target)}.`}>
            <div>
              <p className="tabular text-[36px] leading-none font-semibold tracking-tight">{fmtNumber(totals.kcal)}</p>
              <p className={cn("mt-1.5 text-[12px] font-semibold", zones.kcal.status === "below" && "text-muted-foreground")} style={zones.kcal.status === "below" ? undefined : { color: tone }}>
                {zoneLine(zones.kcal, "kcal")}
              </p>
            </div>
          </ZoneRing>
        ) : (
          <Ring value={null} size={184} stroke={15} color={ENERGY} label={`${fmtNumber(totals.kcal)} kcal, sin objetivos`}>
            <div>
              <p className="tabular text-[36px] leading-none font-semibold tracking-tight">{fmtNumber(totals.kcal)}</p>
              <p className="text-muted-foreground mt-1.5 text-[12px]">kcal</p>
            </div>
          </Ring>
        )}
        <div className="w-full min-w-0 flex-1">
          {zones ? (
            <>
              <p className="text-center text-[17px] font-semibold tracking-tight md:text-left">{headline(zones.kcal)}</p>
              <p className="text-muted-foreground mt-1 text-center text-[13px] md:text-left">
                Tu zona: <span className="tabular">{zoneRange(zones.kcal, "kcal")}</span> · la marca es tu objetivo de <span className="tabular">{fmtNumber(zones.kcal.target)}</span>
              </p>
            </>
          ) : (
            <>
              <p className="text-center text-[17px] font-semibold tracking-tight md:text-left">Sin objetivos diarios</p>
              <p className="text-muted-foreground mt-1 text-center text-[13px] md:text-left">Pídele al Coach tus objetivos de kcal y macros y aparecen aquí.</p>
            </>
          )}
          <div className="mt-4 grid grid-cols-3 gap-3">
            {MACROS.map((m) => {
              const zone = zones?.[m.key];
              return (
                <div key={m.key} className="flex flex-col items-center gap-2 md:flex-row md:gap-3">
                  {zone ? (
                    <ZoneRing zone={zone} size={60} stroke={7} color={m.color} label={`${m.label}: ${fmtNumber(zone.value)} g. ${zoneLine(zone, "g")}. Zona: ${zoneRange(zone, "g")}.`}>
                      <span className="tabular text-[13px] font-semibold">{fmtNumber(totals[m.key])}</span>
                    </ZoneRing>
                  ) : (
                    <Ring value={null} size={60} stroke={7} color={m.color} label={`${m.label}: ${fmtNumber(totals[m.key])} g`}>
                      <span className="tabular text-[13px] font-semibold">{fmtNumber(totals[m.key])}</span>
                    </Ring>
                  )}
                  <div className="min-w-0 text-center md:text-left">
                    <p className="text-[13px] font-medium">{m.label}</p>
                    {zone ? (
                      <>
                        <p className={cn("tabular text-[12px] font-semibold", zone.status === "below" && "text-muted-foreground")} style={zone.status === "below" ? undefined : { color: zoneTone(zone, m.color) }}>
                          {zoneLine(zone, "g")}
                        </p>
                        <p className="text-muted-foreground tabular text-[11px]">{zoneRange(zone, "g")}</p>
                      </>
                    ) : (
                      <p className="text-muted-foreground tabular text-[12px]">g</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {next && <NextMeal meal={next} />}
        </div>
      </div>
    </Card>
  );
}

/** The hero's sentence about kcal: how far to the zone, that the day is in it, or how far past it. */
function headline(z: NutrientZone) {
  if (z.status === "inZone") return "Vas bien: estás en tu zona";
  if (z.status === "above") return <>Te pasaste <span className="tabular text-destructive">{fmtNumber(z.value - (z.max ?? 0))}</span> kcal de tu zona</>;
  return <>Te faltan <span className="tabular">{fmtNumber((z.min ?? 0) - z.value)}</span> kcal para tu zona</>;
}

function NextMeal({ meal }: { meal: SlotView }) {
  const Icon = SLOT_ICONS[meal.slot];
  return (
    <div className="border-border mt-5 flex flex-wrap items-center gap-3 border-t pt-4">
      <span className="bg-body/15 text-body grid size-9 shrink-0 place-items-center rounded-full">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">
          Siguiente: {meal.title}
          {meal.adjusted && <span className="text-training ml-1.5 text-[12px] font-medium">· ajustada</span>}
        </p>
        <p className="text-muted-foreground truncate text-[12px]">
          {meal.label}
          {meal.source && ` · ${meal.source}`} · <span className="tabular">{fmtNumber(meal.kcal)} kcal</span>
        </p>
      </div>
      <EatButton slot={meal} />
    </div>
  );
}

function momentIcon(moment: Moment): LucideIcon {
  if (!moment.drink) return SLOT_ICONS[moment.slot];
  return moment.entries.some((e) => e.alcoholG) ? Wine : CupSoda;
}

/** The day's meals down a timeline, each moment with its foods; correct or delete any of them. */
export function Timeline({ day, className, delay }: { day: DietaDay; className?: string; delay?: number }) {
  const { caffeineMg, alcoholG } = day.summary;
  return (
    <Card className={className} delay={delay}>
      <CardTitle icon={Clock} color={ENERGY} title="Comidas" />
      {(caffeineMg > 0 || alcoholG > 0) && (
        <div className="-mt-1 mb-4 flex flex-wrap gap-1.5">
          {caffeineMg > 0 && (
            <span className="bg-carbs/12 text-carbs flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold">
              <Zap className="size-3" />
              <span className="tabular">{caffeineMg}</span> mg cafeína
            </span>
          )}
          {alcoholG > 0 && (
            <span className="bg-training/12 text-training flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold">
              <Wine className="size-3" />
              <span className="tabular">{fmtNumber(alcoholG, 1)}</span> g alcohol
            </span>
          )}
        </div>
      )}
      {day.moments.length === 0 ? (
        <div className="pb-2">
          <EmptyState
            compact
            icon={UtensilsCrossed}
            color={ENERGY}
            title={day.date === day.today ? "Aún no registraste nada hoy" : "Nada registrado este día"}
            line="Busca en tus frecuentes, escribe una medida casera o el código de barras."
          />
          <EmptyDayActions />
        </div>
      ) : (
        <ol>
          {day.moments.map((moment, i) => {
            const Icon = momentIcon(moment);
            const tint = ENERGY;
            const last = i === day.moments.length - 1;
            return (
              <li key={moment.id} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in oklab, ${tint} 15%, transparent)`, color: tint }}>
                    <Icon className="size-4" strokeWidth={2.2} />
                  </span>
                  {!last && <span className="bg-border my-1 w-0.5 flex-1 rounded-full" />}
                </div>
                <div className={cn("min-w-0 flex-1", !last && "pb-5")}>
                  <div className="flex min-h-9 items-baseline gap-2 pt-1.5">
                    <p className="text-[15px] font-semibold">{moment.title}</p>
                    <p className="text-muted-foreground text-[12px] tabular">
                      {moment.time}
                    </p>
                    <p className="text-muted-foreground ml-auto text-[13px] font-medium tabular">{fmtNumber(moment.kcal)} kcal</p>
                  </div>
                  {moment.note && <p className="text-muted-foreground mb-1 text-[12px] italic">«{moment.note}»</p>}
                  <ul className="-mx-2">
                    {byDish(moment.entries).map(({ dish, entries }) => {
                      const row = (e: DietaEntry) => (
                        <li key={e.id} className="group hover:bg-muted/50 flex min-h-11 items-center gap-3 rounded-xl px-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px]">{e.name}</span>
                            <span className="text-muted-foreground block truncate text-[12px] tabular">
                              {fmtAmount(e.measure, e.quantity, e.unit)}
                              {e.time !== moment.time && ` · ${e.time}`} · {fmtNumber(e.protein)} g prot.
                            </span>
                          </span>
                          <EntryActions entry={e} />
                          <span className="text-muted-foreground w-12 shrink-0 text-right text-[13px] tabular">{fmtNumber(e.kcal)}</span>
                        </li>
                      );
                      return dish ? <DishRow key={dish.id} dish={dish} entries={entries} detail={entries[0]!.time !== moment.time ? entries[0]!.time : undefined} renderEntry={row} /> : row(entries[0]!);
                    })}
                  </ul>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

/** The last seven days of kcal, small, with a way into Progreso. */
export function WeekCard({ progress, href, delay }: { progress: DietaProgress; href: string; delay?: number }) {
  const week = progress.days.slice(-7);
  const logged = week.filter((d) => d.entries > 0);
  return (
    <Card delay={delay}>
      <CardTitle icon={BarChart3} color="var(--domain-body)" title="Esta semana" href={href} action="Progreso" />
      {logged.length === 0 ? (
        <EmptyState compact icon={BarChart3} color="var(--domain-body)" title="Tu semana aparece aquí" line="Registra unos días y verás cómo vas." />
      ) : (
        <>
          <p className="flex items-baseline gap-1.5">
            <span className="tabular text-[26px] leading-none font-semibold">{week.filter((d) => d.onTarget).length}</span>
            <span className="text-muted-foreground text-[13px]">de {logged.length} días en tu zona</span>
          </p>
          <Sparkline
            className="mt-3"
            variant="bars"
            points={week.map((d) => ({ label: fmtDayLabel(d.date), value: d.entries ? Math.round(d.kcal) : null }))}
            color="var(--domain-energy)"
            target={progress.targets?.kcal}
            unit="kcal"
            height={64}
            label="kcal de los últimos 7 días"
          />
        </>
      )}
    </Card>
  );
}

/**
 * The day as Planeado → Real: each meal with what was eaten over what was
 * planned (or still pending, or «sin registrar»), then the day's extras. A batch
 * cooked today shows on top with «Ya lo cociné». Totals compare real and planned.
 */
export function TodayPlan({ day, recipes, entries, title, className, delay }: { day: DayView; recipes: DietaLivingPlan["recipes"]; entries: DietaEntry[]; title: string; className?: string; delay?: number }) {
  const extras = entries.filter((e) => day.extraIds.includes(e.id));
  return (
    <Card className={cn("relative has-[[aria-expanded=true]]:z-10", className)} delay={delay}>
      <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="bg-body/15 text-body grid size-7 place-items-center rounded-lg">
          <ClipboardList className="size-4" strokeWidth={2.2} />
        </span>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {day.slots.length > 0 && (
          <p className="text-muted-foreground ml-auto text-[13px] tabular">
            <span className="text-foreground font-medium">{fmtNumber(day.real.kcal)}</span> real · {fmtNumber(day.asPlanned.kcal)} planeado kcal
          </p>
        )}
      </div>
      {day.preps.length > 0 && (
        <div className="mb-3 space-y-2">
          {day.preps.map((p) => (
            <PrepChip key={p.id} prep={p} recipe={recipes[p.recipeId] ?? null} today={day.date} />
          ))}
        </div>
      )}
      {day.slots.length === 0 ? (
        <EmptyState compact icon={ClipboardList} color="var(--domain-body)" title="Día libre en el plan" line="No hay comidas planeadas este día. Registra lo que comas y cuéntaselo al Coach si quieres ajustar." />
      ) : (
        <SlotList slots={day.slots} recipes={recipes} entries={entries} />
      )}
      {extras.length > 0 && (
        <div className="border-border mt-3 border-t pt-3">
          <p className="text-muted-foreground mb-1 text-[12px] font-semibold tracking-wide uppercase">Extras</p>
          <ul className="-mx-2">
            {byDish(extras).map(({ dish, entries: parts }) => {
              const iconOf = (list: DietaEntry[]) => {
                const Icon = list.every((e) => e.unit === "ml") ? (list.some((e) => e.alcoholG) ? Wine : CupSoda) : Cookie;
                return (
                  <span className="bg-energy/12 text-energy grid size-8 shrink-0 place-items-center rounded-full">
                    <Icon className="size-3.5" />
                  </span>
                );
              };
              const row = (e: DietaEntry, inDish = false) => (
                <li key={e.id} className="group hover:bg-muted/50 flex min-h-11 items-center gap-3 rounded-xl px-2">
                  {!inDish && iconOf([e])}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{e.name}</span>
                    <span className="text-muted-foreground block truncate text-[12px] tabular">
                      {inDish ? fmtAmount(e.measure, e.quantity, e.unit) : `${e.time} · ${fmtAmount(e.measure, e.quantity, e.unit)}`}
                    </span>
                  </span>
                  <EntryActions entry={e} />
                  <span className="text-muted-foreground w-12 shrink-0 text-right text-[13px] tabular">{fmtNumber(e.kcal)}</span>
                </li>
              );
              return dish ? <DishRow key={dish.id} dish={dish} entries={parts} leading={iconOf(parts)} detail={parts[0]!.time} renderEntry={(e) => row(e, true)} /> : row(parts[0]!);
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

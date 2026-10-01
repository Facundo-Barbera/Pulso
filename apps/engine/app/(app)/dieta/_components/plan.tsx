import { Check, ClipboardList, Sparkles } from "lucide-react";
import Link from "next/link";
import type { DietaPlan, PlanMealView } from "@/src/web/dieta";
import { Card } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { EmptyState } from "../../../_ui/empty-state";
import { fmtNumber, fmtTime } from "../../../_ui/format";
import { Ring } from "../../../_ui/ring";
import { ClearAdjustment, EatPlanButton, PlanItemToggle } from "./actions";
import { SLOT_ICONS } from "./hoy";
import { fmtAmount } from "./units";

const BODY = "var(--domain-body)";

export function NoPlan() {
  return (
    <Card>
      <EmptyState icon={ClipboardList} color={BODY} title="Sin plan de comidas" line="El Coach arma uno con tus objetivos y lo adapta a lo que vas comiendo." action={{ href: "/coach", label: "Plan con el Coach" }} />
    </Card>
  );
}

/**
 * Plan: the active plan's day as it should be eaten on the date (with the Coach's
 * adjustment), ticks per item and «Comí lo del plan» per meal. Other plan days
 * can be browsed read-only with `shown`.
 */
export function PlanView({ plan, shown, hrefFor }: { plan: DietaPlan; shown: number; hrefFor: (planDay: number) => string }) {
  const browsing = shown !== plan.dayIndex;
  const meals = browsing ? plan.days[shown]!.meals : plan.meals;
  return (
    <>
      <Card className="relative overflow-hidden">
        <div className="flex items-center gap-5">
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-[13px] font-medium">{browsing ? `${plan.days[shown]!.label} · otro día del plan` : plan.dayLabel}</p>
            <h2 className="mt-1 text-[22px] leading-tight font-semibold tracking-tight">{plan.name}</h2>
            {plan.notes && <p className="text-muted-foreground mt-2 line-clamp-3 max-w-2xl text-[13px] leading-relaxed whitespace-pre-line">{plan.notes}</p>}
          </div>
          {!browsing && (
            <Ring value={plan.total ? (plan.eaten / plan.total) * 100 : 0} size={88} stroke={9} color={BODY} label={`${plan.eaten} de ${plan.total} comidos`}>
              <span className="tabular text-[15px] font-semibold">
                {plan.eaten}/{plan.total}
              </span>
            </Ring>
          )}
        </div>
        {plan.days.length > 1 && (
          <nav className="-mx-1 mt-5 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Días del plan">
            {plan.days.map((d, i) => (
              <Link
                key={i}
                href={hrefFor(i)}
                scroll={false}
                aria-current={i === shown ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-ring flex min-h-10 shrink-0 flex-col justify-center rounded-xl px-3 text-left outline-none focus-visible:ring-2",
                  i === shown ? "bg-body/15 text-foreground" : "hover:bg-muted text-muted-foreground",
                )}
              >
                <span className="text-[13px] font-medium">
                  {d.label}
                  {i === plan.dayIndex && <span className="text-body"> · hoy</span>}
                </span>
                <span className="tabular text-[11px]">{fmtNumber(d.kcal)} kcal</span>
              </Link>
            ))}
          </nav>
        )}
      </Card>

      {!browsing && plan.adjustment && (
        <Card className="border-training/30 bg-training/[0.06] mt-5 border" delay={40}>
          <div className="text-training flex items-center gap-2">
            <Sparkles className="size-4" />
            <p className="text-[14px] font-semibold">Ajustado por el Coach</p>
            <p className="text-muted-foreground ml-auto text-[12px] tabular">{fmtTime(plan.adjustment.createdAt)}</p>
          </div>
          <p className="mt-2 text-[14px]">{plan.adjustment.summary}</p>
          {plan.adjustment.note && <p className="text-muted-foreground mt-1 text-[13px]">{plan.adjustment.note}</p>}
          <div className="mt-3">
            <ClearAdjustment />
          </div>
        </Card>
      )}

      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {meals.map((meal, i) => (
          <PlanMealCard key={meal.slot} meal={meal} editable={!browsing} delay={60 + i * 50} />
        ))}
      </div>
    </>
  );
}

function PlanMealCard({ meal, editable, delay }: { meal: PlanMealView; editable: boolean; delay: number }) {
  const Icon = meal.done ? Check : SLOT_ICONS[meal.slot];
  const pending = meal.items.filter((i) => !i.entryId).map((i) => i.id);
  return (
    <Card delay={delay} className="flex flex-col">
      <div className="flex items-start gap-2.5">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", meal.done ? "bg-body text-background" : "bg-body/15 text-body")}>
          <Icon className="size-4" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] leading-7 font-semibold tracking-tight">{meal.name ?? meal.title}</h3>
          {(meal.name || meal.change) && (
            <p className="text-muted-foreground text-[12px]">
              {meal.name && meal.title}
              {meal.name && meal.change && " · "}
              {meal.change && <span className="text-training">{meal.change === "scaled" ? "Porciones ajustadas" : "Cambiada por el Coach"}</span>}
            </p>
          )}
        </div>
        <p className="text-muted-foreground shrink-0 text-[13px] leading-7 font-medium tabular">{fmtNumber(meal.kcal)} kcal</p>
      </div>
      <ul className="mt-3 flex-1 space-y-0.5">
        {meal.items.map((item) => (
          <li key={item.id} className="flex min-h-11 items-center gap-3">
            {editable && <PlanItemToggle itemId={item.id} entryId={item.entryId} name={item.name} />}
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-[14px]", item.entryId && "text-muted-foreground")}>{item.name}</span>
              <span className="text-muted-foreground block text-[12px] tabular">
                {fmtAmount(null, item.quantity, item.unit)} · {fmtNumber(item.protein)} g prot.
              </span>
            </span>
            <span className="text-muted-foreground text-[13px] tabular">{fmtNumber(item.kcal)}</span>
          </li>
        ))}
      </ul>
      {editable && !meal.done && (
        <div className="mt-4">
          <EatPlanButton itemIds={pending} quiet />
        </div>
      )}
    </Card>
  );
}

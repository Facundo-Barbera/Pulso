import { CalendarDays, ClipboardList, History } from "lucide-react";
import type { DietaLivingPlan } from "@/src/web/dieta-plan";
import { Card, CardTitle } from "../../../_ui/card";
import { EmptyState } from "../../../_ui/empty-state";
import { ChangesList, CoachBar } from "./plan-changes";
import { PlanWeek } from "./plan-week";

const BODY = "var(--domain-body)";

// Plan dates are calendar days: format in UTC so the server's timezone can't shift them.
const dayMonth = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtDay = (date: string) => dayMonth.format(new Date(`${date}T00:00:00Z`));

export function NoPlan() {
  return (
    <Card>
      <EmptyState icon={ClipboardList} color={BODY} title="Sin plan de comidas" line="El Coach arma uno con tus objetivos y lo adapta a lo que vas comiendo." action={{ href: "/coach", label: "Plan con el Coach" }} />
    </Card>
  );
}

/**
 * Plan: the coming days as they stand now — a dated week grid on the desktop,
 * a list of days on the phone — with the cooking sessions on their day, the
 * plan's changes (each undoable) and a quiet way to tell the Coach what changed.
 */
export function LivingPlanView({ plan }: { plan: DietaLivingPlan }) {
  const weeks = Array.from({ length: Math.ceil(plan.days.length / 7) }, (_, i) => plan.days.slice(i * 7, i * 7 + 7));
  return (
    <>
      <p className="text-muted-foreground -mt-1 mb-4 flex items-center gap-2 text-[13px]">
        <CalendarDays className="size-4" />
        <span>
          <span className="text-foreground font-medium">{plan.planName}</span> · próximos {plan.days.length} días, del {fmtDay(plan.from)} al {fmtDay(plan.to)}
        </span>
      </p>
      <div className="space-y-5">
        {weeks.map((days, i) => (
          <PlanWeek key={days[0]!.date} title={i === 0 ? "Esta semana" : `Desde el ${fmtDay(days[0]!.date)}`} days={days} recipes={plan.recipes} today={plan.today} delay={i * 60} />
        ))}
      </div>
      <div className="mt-5">
        <CoachBar planName={plan.planName} from={plan.from} to={plan.to} />
      </div>
      <Card className="mt-5" delay={120}>
        <CardTitle icon={History} color="var(--domain-training)" title="Cambios" />
        <ChangesList revisions={plan.revisions} />
      </Card>
    </>
  );
}

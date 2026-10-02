import { BarChart3, Beef, ClipboardCheck, Droplet, Flame } from "lucide-react";
import type { DietaProgress } from "@/src/web/dieta";
import { Card, CardTitle } from "../../../_ui/card";
import { EmptyState } from "../../../_ui/empty-state";
import { fmtDayLabel, fmtNumber } from "../../../_ui/format";
import { Sparkline } from "../../../_ui/sparkline";
import { StatTile } from "../../../_ui/stat-tile";

const litres = (ml: number) => fmtNumber(ml / 1000, 1);

/** Progreso: the last two weeks — kcal against the target as the hero, then protein, water and how much of the plan was followed. */
export function ProgressView({ progress }: { progress: DietaProgress }) {
  const { days, targets, averages } = progress;
  const label = (date: string) => fmtDayLabel(date);
  const anything = averages.logged > 0 || days.some((d) => d.waterMl > 0);
  if (!anything) {
    return (
      <Card>
        <EmptyState icon={BarChart3} color="var(--domain-body)" title="Tus dos semanas aparecen aquí" line="Registra comidas y agua y verás cómo vas día a día." />
      </Card>
    );
  }
  const hasPlan = days.some((d) => d.planShare !== null);
  return (
    <>
      <Card>
        <CardTitle icon={Flame} color="var(--domain-energy)" title="Calorías, últimos 14 días" />
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <StatTile label="Media diaria" value={averages.kcal === null ? "—" : fmtNumber(averages.kcal)} unit="kcal" caption={targets ? `zona ${fmtNumber(targets.zones.kcal.min ?? 0)}–${fmtNumber(targets.zones.kcal.max ?? targets.kcal)}` : undefined} color="var(--domain-energy)" />
          <StatTile label="Días en zona" value={averages.onTarget} unit={`de ${averages.logged} días`} caption={targets ? "kcal en zona y proteína cumplida" : undefined} color="var(--domain-body)" />
          <StatTile label="Proteína media" value={averages.protein === null ? "—" : fmtNumber(averages.protein)} unit="g" caption={targets ? `mínimo ${fmtNumber(targets.zones.protein.min ?? targets.protein)} g` : undefined} color="var(--domain-protein)" />
          <StatTile label="Plan seguido" value={averages.plan === null ? "—" : fmtNumber(averages.plan * 100)} unit={averages.plan === null ? undefined : "%"} caption={hasPlan ? "de lo planificado, sin hoy" : "sin plan activo"} color="var(--domain-body)" />
        </div>
        <Sparkline
          className="mt-6"
          variant="bars"
          height={150}
          points={days.map((d) => ({ label: label(d.date), value: d.entries ? Math.round(d.kcal) : null }))}
          color="var(--domain-energy)"
          target={targets?.kcal}
          band={targets ? { min: targets.zones.kcal.min ?? 0, max: targets.zones.kcal.max ?? targets.kcal } : undefined}
          unit="kcal"
          label="kcal por día, últimos 14 días; la franja verde es tu zona"
        />
      </Card>

      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Card delay={60}>
          <CardTitle icon={Beef} color="var(--domain-protein)" title="Proteína" />
          <Sparkline
            points={days.map((d) => ({ label: label(d.date), value: d.entries ? Math.round(d.protein) : null }))}
            color="var(--domain-protein)"
            target={targets?.protein}
            band={targets ? { min: targets.zones.protein.min ?? targets.protein, max: targets.zones.protein.max ?? targets.protein } : undefined}
            unit="g"
            height={90}
            label="Proteína por día"
          />
        </Card>
        <Card delay={110}>
          <CardTitle icon={Droplet} color="var(--domain-fat)" title="Agua" />
          <p className="flex items-baseline gap-1.5">
            <span className="tabular text-[26px] leading-none font-semibold">{averages.waterMl === null ? "—" : litres(averages.waterMl)}</span>
            <span className="text-muted-foreground text-[13px]">L de media · objetivo {litres(progress.waterGoalMl)} L</span>
          </p>
          <Sparkline
            className="mt-3"
            variant="bars"
            points={days.map((d) => ({ label: label(d.date), value: d.waterMl ? d.waterMl / 1000 : null }))}
            color="var(--domain-fat)"
            target={progress.waterGoalMl / 1000}
            unit="L"
            decimals={2}
            height={72}
            label="Agua por día"
          />
        </Card>
        {hasPlan && (
          <Card delay={160}>
            <CardTitle icon={ClipboardCheck} color="var(--domain-body)" title="Plan seguido" />
            <Sparkline
              variant="bars"
              points={days.map((d) => ({ label: label(d.date), value: d.planShare === null ? null : Math.round(d.planShare * 100) }))}
              color="var(--domain-body)"
              unit="%"
              height={90}
              label="Parte del plan comida cada día"
            />
          </Card>
        )}
      </div>
    </>
  );
}

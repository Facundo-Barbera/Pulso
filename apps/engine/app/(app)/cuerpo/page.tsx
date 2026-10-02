import type { BodyGoal, BodyScan } from "@pulso/contract";
import { Plus, ScanLine, UserRound } from "lucide-react";
import { bodyOverview } from "@/src/web/cuerpo";
import { Card, CardTitle } from "../../_ui/card";
import { EmptyState } from "../../_ui/empty-state";
import { fmtLongDate, fmtShortDate } from "../../_ui/format";
import { Page, PageHeader } from "../../_ui/page-header";
import { AddScan } from "./_components/add-scan";
import { MuscleFatCard, ObesityCard } from "./_components/analysis";
import { SegmentFigure } from "./_components/body-figure";
import { CompositionCard, hasBreakdown, hasDetails } from "./_components/composition";
import { EvolutionCard, type EvolutionPoint } from "./_components/evolution";
import { BodyHero } from "./_components/hero";
import { HistoryCard, type ScanDelta, type ScanRow } from "./_components/history";
import { isProgress, kg, METRIC } from "./_components/metrics";
import { ProfileForm } from "./_components/profile-form";
import { TrendsCard, type TrendView } from "./_components/trends";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cuerpo" };

const dayYear = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" });

const SHORT = { weight: "Peso", skeletalMuscleMass: "Músculo", bodyFatMass: "Masa grasa" } as const;

/** `scans` newest first; each delta against the next older scan that measured the metric. */
function row(scan: BodyScan, scans: BodyScan[], goals: BodyGoal[]): ScanRow {
  const older = scans.slice(scans.indexOf(scan) + 1);
  const deltas: ScanDelta[] = (["weight", "skeletalMuscleMass", "bodyFatMass"] as const)
    .flatMap((metric) => {
      const now = scan[metric];
      const before = older.find((s) => s[metric] != null)?.[metric];
      if (now == null || before == null) return [];
      const delta = Math.round((now - before) * 10) / 10;
      const good = isProgress(metric, delta, now, goals.find((g) => g.metric === metric)?.target);
      return [{ metric, label: SHORT[metric], text: `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${kg(Math.abs(delta))} ${METRIC[metric].unit}`, good }];
    });
  const values = [
    scan.weight != null && `${kg(scan.weight)} kg`,
    scan.percentBodyFat != null && `${kg(scan.percentBodyFat)} % grasa`,
    scan.skeletalMuscleMass != null && `${kg(scan.skeletalMuscleMass)} kg músculo`,
  ].filter(Boolean);
  const source = scan.source === "inbody" ? (scan.device ? `InBody ${scan.device}` : "InBody") : "A mano";
  return { id: scan.id, date: dayYear.format(scan.measuredAt), source, inbody: scan.source === "inbody", device: scan.device, values: values.join(" · ") || source, deltas };
}

/**
 * Cuerpo: the latest scan as the hero, then trends with the engine's
 * projection, composition, InBody's segment, muscle-fat and obesity analyses,
 * the evolution across scans, history, import and the profile.
 */
export default function Cuerpo() {
  const body = bodyOverview();
  const latest = body.latest;
  const goals = new Map(body.goals.map((g) => [g.metric, g.target]));
  const trends: TrendView[] = body.projections.map((p) => ({
    metric: p.metric,
    points: p.observed.map((o) => ({ label: fmtShortDate(o.at), value: o.value })),
    current: p.current,
    note: p.note,
    horizons: p.horizons.map((h) => ({ weeks: h.weeks, value: h.value, low: h.low, high: h.high, date: fmtShortDate(h.at) })),
    goal: p.goal ? { target: p.goal.target, message: p.goal.message } : null,
  }));
  // A partial scan (weight only, a short QR) should not hide what an earlier full sheet measured.
  const dated = (scan: BodyScan | undefined) => scan && { scan, date: scan !== latest ? fmtShortDate(scan.measuredAt) : undefined };
  const breakdown = dated(body.scans.find(hasBreakdown));
  const sheet = dated(body.scans.find(hasDetails));
  const { analysis } = body;
  const olderDate = (at: number | undefined) => (at !== undefined && latest && at !== latest.measuredAt ? fmtShortDate(at) : undefined);
  const obesityAt = analysis.obesity.length ? Math.min(...analysis.obesity.map((g) => g.measuredAt)) : undefined;
  const evolution: EvolutionPoint[] = body.scans
    .filter((s) => s.weight != null && s.skeletalMuscleMass != null && s.bodyFatMass != null)
    .slice(0, 24)
    .reverse()
    .map((s) => ({ label: fmtShortDate(s.measuredAt), weight: s.weight!, skeletalMuscleMass: s.skeletalMuscleMass!, bodyFatMass: s.bodyFatMass! }));
  const add = (
    <a href="#anadir" className="bg-primary text-primary-foreground focus-visible:ring-ring app-no-drag inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-2">
      <Plus className="size-4" /> Añadir medición
    </a>
  );

  return (
    <Page>
      <PageHeader title="Cuerpo" subtitle="Composición corporal, hacia dónde vas y tu perfil." actions={latest ? add : undefined} />
      {latest ? (
        <>
          <BodyHero scan={latest} readings={body.readings} goals={goals} date={fmtLongDate(latest.measuredAt)} />
          <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            <TrendsCard trends={trends} delay={60} className="md:col-span-2" />
            <CompositionCard breakdown={breakdown} sheet={sheet} delay={110} />
            {analysis.segments && <SegmentFigure segments={analysis.segments} date={olderDate(analysis.segments.measuredAt)} delay={160} />}
            <MuscleFatCard analysis={analysis} date={olderDate(analysis.muscleFat?.measuredAt)} delay={200} />
            {analysis.obesity.length > 0 && <ObesityCard gauges={analysis.obesity} date={olderDate(obesityAt)} delay={240} />}
            <EvolutionCard points={evolution} delay={270} className="md:col-span-2" />
            <HistoryCard rows={body.scans.map((s) => row(s, body.scans, body.goals))} delay={300} />
            <Card delay={330} className="scroll-mt-6">
              <div id="anadir" className="scroll-mt-20" />
              <CardTitle icon={Plus} color="var(--domain-body)" title="Añadir medición" />
              <AddScan />
            </Card>
            <Card delay={360} className="scroll-mt-6 md:col-span-2">
              <div id="perfil" className="scroll-mt-20" />
              <CardTitle icon={UserRound} color="var(--domain-body)" title="Perfil" />
              <ProfileForm profile={body.profile} />
            </Card>
          </div>
        </>
      ) : (
        <div className="grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
          <Card className="lg:col-span-3">
            <EmptyState icon={ScanLine} color="var(--domain-body)" title="Tu composición corporal" line="Importa el CSV o el QR de tu InBody para ver músculo, grasa y hacia dónde vas. También puedes cargar el peso a mano." />
            <div id="anadir" className="mx-auto max-w-lg">
              <AddScan />
            </div>
          </Card>
          <Card delay={60} className="lg:col-span-2">
            <div id="perfil" className="scroll-mt-20" />
            <CardTitle icon={UserRound} color="var(--domain-body)" title="Perfil" />
            <ProfileForm profile={body.profile} />
          </Card>
        </div>
      )}
    </Page>
  );
}

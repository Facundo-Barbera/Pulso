import type { BodyScan } from "@pulso/contract";
import { Plus, ScanLine, UserRound } from "lucide-react";
import { bodyOverview } from "@/src/web/cuerpo";
import { Card, CardTitle } from "../../_ui/card";
import { EmptyState } from "../../_ui/empty-state";
import { fmtLongDate, fmtShortDate } from "../../_ui/format";
import { Page, PageHeader } from "../../_ui/page-header";
import { AddScan } from "./_components/add-scan";
import { CompositionCard, hasBreakdown, hasDetails, SegmentalCard } from "./_components/composition";
import { BodyHero } from "./_components/hero";
import { HistoryCard, type ScanRow } from "./_components/history";
import { kg } from "./_components/metrics";
import { ProfileForm } from "./_components/profile-form";
import { TrendsCard, type TrendView } from "./_components/trends";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cuerpo" };

const dayYear = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" });

function row(scan: BodyScan): ScanRow {
  const values = [
    scan.weight != null && `${kg(scan.weight)} kg`,
    scan.percentBodyFat != null && `${kg(scan.percentBodyFat)} % grasa`,
    scan.skeletalMuscleMass != null && `${kg(scan.skeletalMuscleMass)} kg músculo`,
  ].filter(Boolean);
  const source = scan.source === "inbody" ? (scan.device ? `InBody ${scan.device}` : "InBody") : "A mano";
  return { id: scan.id, date: dayYear.format(scan.measuredAt), source, inbody: scan.source === "inbody", values: [source, ...values].join(" · ") };
}

/** Cuerpo: the latest scan as the hero, then trends with the engine's projection, composition, segments, profile, history and import. */
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
  const segments = dated(body.scans.find((s) => s.segmentalLean || s.segmentalFat));
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
            {segments && <SegmentalCard lean={segments.scan.segmentalLean} fat={segments.scan.segmentalFat} date={segments.date} delay={160} />}
            <HistoryCard rows={body.scans.map(row)} delay={210} />
            <Card delay={260} className="scroll-mt-6">
              <div id="anadir" className="scroll-mt-20" />
              <CardTitle icon={Plus} color="var(--domain-body)" title="Añadir medición" />
              <AddScan />
            </Card>
            <Card delay={310} className="md:col-span-2 xl:col-span-3">
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
            <CardTitle icon={UserRound} color="var(--domain-body)" title="Perfil" />
            <ProfileForm profile={body.profile} />
          </Card>
        </div>
      )}
    </Page>
  );
}

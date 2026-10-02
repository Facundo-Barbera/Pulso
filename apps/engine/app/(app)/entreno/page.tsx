import { Dumbbell } from "lucide-react";
import { nudgeReviews } from "@/src/training/review";
import { entrenoOverview } from "@/src/web/entreno";
import { Card } from "../../_ui/card";
import { EmptyState } from "../../_ui/empty-state";
import { Page, PageHeader } from "../../_ui/page-header";
import { canEdit } from "./_components/can-edit";
import { HistoryCard, ProgramCard } from "./_components/cards";
import { Plan } from "./_components/plan";
import { DefaultUnit } from "./_components/units";
import { WeekHero } from "./_components/week-hero";
import { Weeks } from "./_components/weeks";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entreno" };

/**
 * Entreno: one hero (this week's progress and the next workout), the weeks of
 * every block with what happened each day, the program's days with their
 * exercises, then history and the program's notes.
 */
export default async function Entreno() {
  // Opening Entreno catches up a review of the next workout that is due.
  nudgeReviews();
  const view = entrenoOverview();
  const edit = await canEdit();
  const { program } = view;

  if (!program) {
    return (
      <Page>
        <PageHeader title="Entreno" subtitle="Programa, sesiones y progresión de cargas." actions={edit && <DefaultUnit value={view.defaultUnit} />} />
        <Card>
          <EmptyState icon={Dumbbell} color="var(--domain-training)" title="Aún no tienes rutina" line="Pídele al Coach un programa: lo verás aquí con los pesos sugeridos para cada día." action={{ href: "/coach", label: "Pedir rutina al Coach" }} />
        </Card>
        <div className="mt-5">
          <HistoryCard history={view.history} delay={60} canEdit={edit} />
        </div>
      </Page>
    );
  }

  const block = view.blocks.find((b) => b.programId === program.id) ?? null;
  const next = view.adjusted ?? view.days.find((d) => d.id === view.nextDayId) ?? null;
  const doneIds = block?.weeks[block.currentWeek - 1]?.days.filter((d) => d.sessions.length > 0).map((d) => d.dayId) ?? [];
  return (
    <Page>
      <PageHeader
        eyebrow={<span className="text-training font-semibold">{view.blocks.length > 1 && block ? `Bloque ${block.number} · ` : ""}Entreno</span>}
        title={program.name}
        actions={edit && <DefaultUnit value={view.defaultUnit} />}
      />
      <WeekHero block={block} weeks={program.weeks} day={next} adjustment={view.adjustment} firstDay={view.days[0]?.name ?? null} canEdit={edit} />
      <div className="mt-5">
        <Weeks blocks={view.blocks} sessions={view.sessions} nextDayId={view.nextDayId} canEdit={edit} />
      </div>
      <div className="mt-5">
        <Plan days={view.days} nextDayId={view.nextDayId} doneIds={doneIds} canEdit={edit} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <HistoryCard history={view.history} delay={60} className="lg:col-span-2" canEdit={edit} />
        <ProgramCard program={program} days={view.days.length} delay={110} />
      </div>
    </Page>
  );
}

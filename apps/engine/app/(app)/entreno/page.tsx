import { ArrowDownRight, Dumbbell } from "lucide-react";
import { entrenoOverview } from "@/src/web/entreno";
import { Card } from "../../_ui/card";
import { EmptyState } from "../../_ui/empty-state";
import { Page, PageHeader } from "../../_ui/page-header";
import { canEdit } from "./_components/can-edit";
import { HistoryCard, ProgramCard } from "./_components/cards";
import { Plan } from "./_components/plan";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entreno" };

/** Entreno: the selected day of the active program as the hero, then history and the program's notes. */
export default async function Entreno() {
  const view = entrenoOverview();
  const edit = await canEdit();
  const { program } = view;

  if (!program) {
    return (
      <Page>
        <PageHeader title="Entreno" subtitle="Programa, sesiones y progresión de cargas." />
        <Card>
          <EmptyState icon={Dumbbell} color="var(--domain-training)" title="Aún no tienes rutina" line="Pídele al Coach un programa: lo verás aquí con los pesos sugeridos para cada día." action={{ href: "/coach", label: "Pedir rutina al Coach" }} />
        </Card>
        <div className="mt-5">
          <HistoryCard history={view.history} delay={60} />
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow={
          <span className="text-training flex items-center gap-2 font-semibold">
            Semana {program.week} de {program.weeks}
            {program.deload && (
              <span className="bg-training/15 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px]">
                <ArrowDownRight className="size-3" /> Descarga
              </span>
            )}
          </span>
        }
        title={program.name}
      />
      <Plan days={view.days} nextDayId={view.nextDayId} canEdit={edit} />
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <HistoryCard history={view.history} delay={60} className="lg:col-span-2" />
        <ProgramCard program={program} days={view.days.length} delay={110} />
      </div>
    </Page>
  );
}

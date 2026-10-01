import { Lock } from "lucide-react";
import { entrenoOverview } from "@/src/web/entreno";
import { Card } from "../../../_ui/card";
import { EmptyState } from "../../../_ui/empty-state";
import { Page, PageHeader } from "../../../_ui/page-header";
import { canEdit } from "../_components/can-edit";
import { Logger } from "../_components/logger";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sesión" };

/** The session logger: resumes the one in progress in this browser, or starts `?dia=<day id>`. */
export default async function Sesion({ searchParams }: { searchParams: Promise<{ dia?: string }> }) {
  if (!(await canEdit())) {
    return (
      <Page>
        <PageHeader title="Sesión" />
        <Card>
          <EmptyState icon={Lock} color="var(--domain-training)" title="Este navegador sólo puede mirar" line="Para registrar sesiones, empareja este navegador con permiso de edición desde Ajustes en la Mac." action={{ href: "/entreno", label: "Volver a Entreno" }} />
        </Card>
      </Page>
    );
  }
  const { dia } = await searchParams;
  const view = entrenoOverview();
  return (
    <Page>
      <Logger days={view.days} programId={view.program?.id ?? null} dayId={dia ?? null} defaultUnit={view.defaultUnit} />
    </Page>
  );
}

import { Card } from "./card";
import { EmptyState } from "./empty-state";
import { Page, PageHeader } from "./page-header";
import { SECTIONS } from "./sections";

/** A section that is not built yet: its header and a designed empty state. Replace the page, not this component. */
export function ComingSoon({ href, subtitle, line }: { href: string; subtitle: string; line: string }) {
  const section = SECTIONS.find((s) => s.href === href)!;
  return (
    <Page>
      <PageHeader title={section.label} subtitle={subtitle} />
      <Card>
        <EmptyState icon={section.icon} color={section.color} title="Muy pronto, también aquí" line={line} action={{ href: "/", label: "Volver a Hoy" }} />
      </Card>
    </Page>
  );
}

import { MessagesSquare } from "lucide-react";
import { coachThread } from "@/src/web/coach";
import { EmptyState } from "../../../_ui/empty-state";
import { ThreadView } from "../_components/chat";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  return { title: coachThread((await params).id)?.thread.title ?? "Coach" };
}

export default async function Thread({ params }: Props) {
  const view = coachThread((await params).id);
  if (!view) {
    return (
      <div className="grid h-full place-items-center px-6">
        <EmptyState icon={MessagesSquare} color="var(--pulso-violet)" title="Esta conversación ya no está" line="Puede que se haya eliminado desde otro dispositivo." action={{ href: "/coach/nuevo", label: "Empezar otra" }} />
      </div>
    );
  }
  return <ThreadView key={view.thread.id} initial={view} />;
}

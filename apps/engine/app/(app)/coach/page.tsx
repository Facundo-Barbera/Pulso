import { coachBrief, coachConversation } from "@/src/web/coach";
import { CoachFeed } from "./_components/chat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coach" };

type Props = { searchParams: Promise<{ q?: string; responder?: string }> };

/** /coach: the one conversation. `?q=` sends a prompt at once; `?responder=<brief id>` quotes that brief into it. */
export default async function Coach({ searchParams }: Props) {
  const { q, responder } = await searchParams;
  return (
    <div className="flex h-full min-h-0">
      <CoachFeed initial={coachConversation()} brief={coachBrief()} starter={q?.trim().slice(0, 2000) || null} replyTo={responder ?? null} />
    </div>
  );
}

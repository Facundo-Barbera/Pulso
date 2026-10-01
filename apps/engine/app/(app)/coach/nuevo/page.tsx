import { coachBrief } from "@/src/web/coach";
import { NewChatView } from "../_components/chat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nueva conversación" };

type Props = { searchParams: Promise<{ q?: string; responder?: string }> };

/** A new chat. `?q=` sends a prompt at once; `?responder=<brief id>` opens it as a reply to that brief. */
export default async function NewChat({ searchParams }: Props) {
  const { q, responder } = await searchParams;
  const { brief, replyTo } = coachBrief(responder);
  const starter = q?.trim().slice(0, 2000) || null;
  return <NewChatView key={`${starter}|${replyTo?.id}`} brief={brief} replyTo={replyTo} starter={starter} />;
}

import { coachBrief } from "@/src/web/coach";
import { NewChatView } from "./_components/chat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coach" };

/** /coach: a new chat beside the list on wide screens; on the phone the list alone (the frame hides this). */
export default function Coach() {
  const { brief } = coachBrief();
  return <NewChatView brief={brief} replyTo={null} starter={null} />;
}

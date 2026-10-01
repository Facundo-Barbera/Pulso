import { listThreads } from "@/src/agent/threads";
import { CoachFrame } from "./_components/frame";

export const dynamic = "force-dynamic";

/** The thread list stays mounted while the person moves between chats. */
export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return <CoachFrame threads={listThreads()}>{children}</CoachFrame>;
}

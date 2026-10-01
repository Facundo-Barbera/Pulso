"use client";

import type { AgentThread } from "@pulso/contract";
import { usePathname } from "next/navigation";
import { cn } from "../../../_ui/cn";
import { ThreadList } from "./thread-list";

/**
 * The Coach's two panes: conversations beside the chat on wide screens; on the
 * phone, list → detail, with /coach as the list.
 */
export function CoachFrame({ threads, children }: { threads: AgentThread[]; children: React.ReactNode }) {
  const list = usePathname() === "/coach";
  return (
    <div className="flex h-full min-h-0">
      <aside className={cn("border-border bg-muted/25 w-full shrink-0 flex-col md:flex md:w-[300px] md:border-r lg:w-[320px]", list ? "flex" : "hidden")} aria-label="Conversaciones con el Coach">
        <ThreadList initial={threads} />
      </aside>
      <div className={cn("min-w-0 flex-1 flex-col md:flex", list ? "hidden" : "flex")}>{children}</div>
    </div>
  );
}

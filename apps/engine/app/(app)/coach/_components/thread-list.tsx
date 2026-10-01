"use client";

import type { AgentThread } from "@pulso/contract";
import { MessagesSquare, SquarePen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../../../_ui/cn";
import { EmptyState } from "../../../_ui/empty-state";
import { fmtAgo } from "../../../_ui/format";
import { plainText } from "../../../_ui/markdown-parse";
import { seedThreads, useThreads } from "./chat-store";
import { STARTERS } from "./starters";

/** The conversations, newest first. A side column on wide screens; the whole page on the phone at /coach. */
export function ThreadList({ initial }: { initial: AgentThread[] }) {
  seedThreads(initial);
  const pathname = usePathname();
  const { threads, streaming } = useThreads(initial);
  const home = pathname === "/coach";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="app-drag relative z-10 flex shrink-0 items-end gap-2 px-5 pt-[calc(env(safe-area-inset-top)+20px)] pb-3 md:h-[var(--titlebar-height)] md:items-center md:px-4 md:pt-0 md:pb-0">
        <h1 className="flex-1 text-[30px] leading-tight font-semibold tracking-tight md:text-[15px]">Coach</h1>
        <Link
          href="/coach/nuevo"
          className="app-no-drag bg-primary text-primary-foreground focus-visible:ring-ring inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-2 md:min-h-8 md:px-3"
          title="Nueva conversación (⌘K)"
        >
          <SquarePen className="size-4" />
          Nueva
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-3">
        {/* The phone's list page opens new chats with a prompt; on wide screens the empty chat beside it has them. */}
        <div className="-mx-3 mb-3 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] md:hidden">
          {STARTERS.map(({ text, icon: Icon, color }) => (
            <Link key={text} href={`/coach/nuevo?q=${encodeURIComponent(text)}`} className="bg-card shadow-1 flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13.5px] font-medium">
              <Icon className="size-4" style={{ color }} />
              {text}
            </Link>
          ))}
        </div>

        {threads.length === 0 ? (
          <EmptyState compact={!home} icon={MessagesSquare} color="var(--pulso-violet)" title="Sin conversaciones todavía" line="Pregúntale algo al Coach y la conversación quedará aquí." action={home ? { href: "/coach/nuevo", label: "Empezar una" } : undefined} />
        ) : (
          <ul className="space-y-0.5" aria-label="Conversaciones">
            {threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} active={pathname === `/coach/${thread.id}`} live={streaming.has(thread.id)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ThreadRow({ thread, active, live }: { thread: AgentThread; active: boolean; live: boolean }) {
  return (
    <li>
      <Link
        href={`/coach/${thread.id}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "focus-visible:ring-ring block rounded-xl px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 max-md:min-h-16 max-md:py-3",
          active ? "bg-accent shadow-1" : "hover:bg-muted/70",
        )}
      >
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{thread.title}</span>
          {live ? (
            <span className="text-primary flex shrink-0 items-center gap-1 text-[11.5px] font-medium">
              <span className="bg-primary size-1.5 rounded-full motion-safe:animate-pulse" />
              respondiendo
            </span>
          ) : (
            <span className="text-muted-foreground shrink-0 text-[11.5px]" suppressHydrationWarning>
              {fmtAgo(thread.updatedAt)}
            </span>
          )}
        </span>
        {thread.preview && <span className="text-muted-foreground mt-0.5 line-clamp-2 text-[13px] leading-snug">{plainText(thread.preview)}</span>}
      </Link>
    </li>
  );
}

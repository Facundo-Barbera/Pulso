"use client";

import type { PlanRevision } from "@pulso/contract";
import { History, MessageCircle, Send, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "../../../_ui/cn";
import { EmptyState } from "../../../_ui/empty-state";
import { fmtAgo } from "../../../_ui/format";
import { field } from "./sheet";
import { usePlanActions } from "./plan-actions";

const SHOWN = 6;

/** The plan's changes, newest first. A live one can be undone; the engine refuses (with a reason) when a later change overlaps it. */
export function ChangesList({ revisions }: { revisions: PlanRevision[] }) {
  const actions = usePlanActions();
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const visible = all ? revisions : revisions.slice(0, SHOWN);

  if (!revisions.length)
    return <EmptyState compact icon={History} color="var(--domain-training)" title="El plan está como lo armó el Coach" line="Cuando algo cambie — una comida saltada, un batch movido — queda aquí y se puede deshacer." />;

  return (
    <>
      <ol className="-mx-2">
        {visible.map((r) => {
          const undone = r.undoneAt !== null;
          return (
            <li key={r.id} className="hover:bg-muted/50 flex min-h-12 items-center gap-3 rounded-xl px-2 py-2">
              <span className={cn("mt-[7px] size-2 shrink-0 self-start rounded-full", undone || r.op === "undo" ? "bg-border" : "bg-training")} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={cn("text-[14px] leading-snug", undone && "text-muted-foreground line-through decoration-1")}>{r.summary}</p>
                <p className="text-muted-foreground text-[12px]">
                  {fmtAgo(r.createdAt)}
                  {undone && " · deshecho"}
                </p>
              </div>
              {!undone && r.op !== "undo" && (
                <button
                  onClick={async () => {
                    setBusy(r.id);
                    await actions.undo(r.id);
                    setBusy(null);
                  }}
                  disabled={busy !== null}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium outline-none focus-visible:ring-2 disabled:opacity-50"
                >
                  <Undo2 className="size-3.5" />
                  Deshacer
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {revisions.length > SHOWN && (
        <button onClick={() => setAll(!all)} className="text-muted-foreground hover:text-foreground mt-2 min-h-9 rounded-lg px-1 text-[13px] font-medium">
          {all ? "Ver menos" : `Ver los ${revisions.length}`}
        </button>
      )}
    </>
  );
}

/** A quiet line to tell the Coach what changed in real life; it opens a new chat with the plan's range as context. */
export function CoachBar({ planName, from, to }: { planName: string; from: string; to: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const submit = () => {
    const said = text.trim();
    if (!said) return;
    const q = `Sobre mi plan de comidas «${planName}» (del ${from} al ${to}): ${said}\n\nAjusta el plan con cambios pequeños y deshacibles; no lo rehagas entero.`;
    router.push(`/coach/nuevo?q=${encodeURIComponent(q)}`);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="bg-card shadow-1 flex items-center gap-2 rounded-[18px] py-2 pr-2 pl-4"
    >
      <MessageCircle className="text-muted-foreground size-4 shrink-0" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Cuéntale al Coach qué cambió: «el jueves ceno fuera», «no encontré salmón»…"
        className={cn(field, "h-10 flex-1 border-transparent bg-transparent px-1 focus-visible:ring-0")}
        aria-label="Cuéntale al Coach qué cambió"
      />
      <button type="submit" disabled={!text.trim()} className="bg-primary text-primary-foreground focus-visible:ring-ring grid size-10 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 disabled:opacity-30" aria-label="Contárselo al Coach">
        <Send className="size-4" />
      </button>
    </form>
  );
}

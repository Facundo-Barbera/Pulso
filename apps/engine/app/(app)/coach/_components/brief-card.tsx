"use client";

import type { CoachBrief, CoachBriefs } from "@pulso/contract";
import { CornerUpLeft, RotateCw, Sunrise } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../../_ui/cn";
import { fmtAgo, fmtLongDate } from "../../../_ui/format";
import { Markdown } from "../../../_ui/markdown";
import { CoachAvatar, Glow, ThinkingDots } from "./bits";

const POLL_MS = 3000;

const pad = (n: number) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * The morning brief at the top of a new chat. «Responder» starts the
 * conversation from it; the arrow writes it again (and this card follows
 * along until it is done).
 */
export function BriefCard({ initial, onReply }: { initial: CoachBrief | null; onReply: (brief: CoachBrief) => void }) {
  const [brief, setBrief] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const writing = brief?.status === "running";

  useEffect(() => {
    if (!writing) return;
    const timer = setInterval(async () => {
      const response = await fetch("/api/web/coach/brief", { cache: "no-store" }).catch(() => null);
      if (response?.ok) setBrief(((await response.json()) as CoachBriefs).daily);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [writing]);

  async function regenerate() {
    setError(null);
    const response = await fetch("/api/web/coach/brief/regenerate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "daily" }) }).catch(() => null);
    if (!response?.ok) return setError(response?.status === 403 ? "Este navegador no puede pedirle eso al Coach." : "No se pudo hablar con la Mac.");
    const body = (await response.json()) as { brief: CoachBrief | null };
    if (body.brief) setBrief(body.brief);
  }

  const subtitle = !brief ? null : writing ? (brief.text ? "Actualizando…" : "Escribiendo…") : brief.period === today() ? `Hoy · escrito ${fmtAgo(brief.updatedAt)}` : fmtLongDate(new Date(`${brief.period}T12:00:00`));

  return (
    <Glow active={writing} radius={18}>
      <section className="bg-card shadow-1 rounded-[18px] p-5" aria-label="Resumen del Coach">
        <header className="mb-3 flex items-center gap-3">
          <CoachAvatar size={32} active={writing} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight">Resumen del Coach</h2>
            {subtitle && (
              <p className="text-muted-foreground text-[12.5px] first-letter:uppercase" suppressHydrationWarning>
                {subtitle}
              </p>
            )}
          </div>
          {brief?.text && (
            <button onClick={regenerate} disabled={writing} className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-9 place-items-center rounded-full outline-none focus-visible:ring-2 disabled:opacity-50" aria-label="Volver a escribir el resumen" title="Volver a escribir">
              <RotateCw className={cn("size-4", writing && "motion-safe:animate-spin")} />
            </button>
          )}
        </header>

        {brief?.text ? (
          <>
            <Markdown text={brief.text} className={cn("max-h-[320px] space-y-2.5 overflow-y-auto text-[14.5px] leading-relaxed transition-opacity", writing && "opacity-55")} />
            <button
              onClick={() => onReply(brief)}
              disabled={writing}
              className="bg-primary text-primary-foreground focus-visible:ring-ring mt-4 inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-[13.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              <CornerUpLeft className="size-4" />
              Responder
            </button>
          </>
        ) : writing ? (
          <div className="flex items-center gap-3">
            <ThinkingDots />
            <p className="text-muted-foreground text-[14px]">Tu Coach está revisando tus datos…</p>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground flex items-start gap-3 text-[14px] leading-relaxed">
              <Sunrise className="text-carbs mt-0.5 size-5 shrink-0" />
              {brief?.status === "error" ? "El Coach no pudo preparar tu resumen. Puedes pedírselo otra vez." : "Cada mañana tu Coach te deja aquí un resumen del día: recuperación, entreno, comida y medicación."}
            </p>
            <button onClick={regenerate} className="bg-muted hover:bg-accent focus-visible:ring-ring inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-[13.5px] font-medium outline-none focus-visible:ring-2">
              <RotateCw className="size-4" />
              Preparar ahora
            </button>
          </div>
        )}
        {error && <p className="text-warning mt-3 text-[13px]">{error}</p>}
      </section>
    </Glow>
  );
}

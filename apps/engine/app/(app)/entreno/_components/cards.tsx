import { CalendarDays, ChevronDown, ClipboardList, Dumbbell, History, Repeat, Trophy, Watch } from "lucide-react";
import { formatSetShort } from "@/src/training/segments";
import type { HistoryEntry, ProgramHeader } from "@/src/web/entreno";
import { Card, CardTitle } from "../../../_ui/card";
import { EmptyState } from "../../../_ui/empty-state";
import { fmtLongDate, fmtMinutes, fmtNumber, fmtTime } from "../../../_ui/format";
import { Recorded } from "./recorded";

/**
 * Sessions logged in Pulso and workouts from Salud, newest first, each workout
 * once (what the Watch recorded during a session is inside it). Each opens to its detail.
 */
export function HistoryCard({ history, delay, className, canEdit = false }: { history: HistoryEntry[]; delay?: number; className?: string; canEdit?: boolean }) {
  return (
    <Card delay={delay} className={className}>
      <CardTitle icon={History} color="var(--domain-training)" title="Últimas sesiones" />
      {history.length === 0 ? (
        <EmptyState compact icon={Dumbbell} color="var(--domain-training)" title="Aún no has entrenado" line="Las sesiones que registres aquí o en el iPhone, y los entrenamientos de Salud, aparecerán en esta lista." />
      ) : (
        <ul className="-mx-2">
          {history.map((h) => (
            <li key={`${h.kind}-${h.id}`}>
              <details className="group rounded-2xl open:bg-muted/40">
                <summary className="hover:bg-muted/60 focus-visible:ring-ring flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl px-2 py-2 outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
                  <span className={`relative grid size-9 shrink-0 place-items-center rounded-xl ${h.kind === "session" ? "bg-training/15 text-training" : "bg-energy/15 text-energy"}`}>
                    {h.kind === "session" ? <Dumbbell className="size-4" /> : <Watch className="size-4" />}
                    {h.merged && (
                      <span className="bg-card text-heart absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full shadow-1" aria-label="Con datos de Apple Watch">
                        <Watch className="size-2.5" />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[15px] font-medium">
                      <span className="truncate">{h.title}</span>
                      {h.exercises.some((e) => e.record) && <Trophy className="text-carbs size-3.5 shrink-0" aria-label="Con récord" />}
                    </span>
                    <span className="text-muted-foreground block text-[13px] first-letter:uppercase">{fmtLongDate(h.startedAt)}</span>
                  </span>
                  <span className="text-right">
                    <span className="tabular block text-[14px] font-semibold">{fmtMinutes((h.endedAt - h.startedAt) / 60_000)}</span>
                    {h.summary && <span className="text-muted-foreground tabular block text-[12px]">{h.summary}</span>}
                  </span>
                  <ChevronDown className="text-muted-foreground size-4 shrink-0 motion-safe:transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-2 pt-1 pb-4 pl-14">
                  <p className="text-muted-foreground mb-2 text-[12px]">
                    {fmtTime(h.startedAt)} – {fmtTime(h.endedAt)}
                    {h.source && ` · ${h.source}`}
                  </p>
                  {h.kind === "session" ? (
                    <SessionDetail entry={h} canEdit={canEdit} />
                  ) : (
                    <dl className="tabular grid grid-cols-3 gap-3 text-[13px]">
                      <Fact label="Duración" value={fmtMinutes((h.endedAt - h.startedAt) / 60_000)} />
                      <Fact label="Energía" value={h.energy != null ? `${fmtNumber(h.energy)} kcal` : "—"} />
                      <Fact label="Distancia" value={h.distanceKm != null ? `${fmtNumber(h.distanceKm, 2)} km` : "—"} />
                    </dl>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** What was lifted in a logged session, exercise by exercise, in the order it was done, then what the Watch recorded. */
export function SessionDetail({ entry: h, canEdit = false }: { entry: HistoryEntry; canEdit?: boolean }) {
  return (
    <>
      <Lifted entry={h} />
      <Recorded entry={h} canEdit={canEdit} />
    </>
  );
}

function Lifted({ entry: h }: { entry: HistoryEntry }) {
  return h.exercises.length === 0 ? (
    <p className="text-muted-foreground text-[13px]">Sin series registradas.</p>
  ) : (
    <ul className="space-y-2">
      {h.exercises.map((e) => (
        <li key={e.exerciseId} className="text-[13px]">
          <span className="flex items-center gap-1.5 font-medium">
            {e.name}
            {e.record && <Trophy className="text-carbs size-3" aria-label="Récord" />}
            {e.sets.some((s) => s.weightKg > 0) && <span className="text-muted-foreground text-[11px] font-normal">{e.unit}</span>}
          </span>
          <span className="text-muted-foreground tabular">
            {/* A set where the load dropped mid-set reads "80 × 5 → 60 × 3". */}
            {e.sets.map((s) => formatSetShort(s, e.unit) + (s.rpe ? ` @${fmtNumber(s.rpe, 1)}` : "")).join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export function ProgramCard({ program, days, delay }: { program: ProgramHeader; days: number; delay?: number }) {
  return (
    <Card delay={delay}>
      <CardTitle icon={ClipboardList} color="var(--domain-training)" title="Sobre el programa" />
      <p className="text-[14px] leading-relaxed">{program.goal}</p>
      <p className="text-muted-foreground mt-3 flex gap-4 text-[13px]">
        <span className="flex items-center gap-1.5">
          <CalendarDays className="size-3.5" /> {program.weeks} semanas
        </span>
        <span className="flex items-center gap-1.5">
          <Repeat className="size-3.5" /> {days} {days === 1 ? "día" : "días"}
        </span>
      </p>
      {program.notes && <p className="text-muted-foreground border-border mt-4 border-t pt-4 text-[13px] leading-relaxed whitespace-pre-line">{program.notes}</p>}
    </Card>
  );
}

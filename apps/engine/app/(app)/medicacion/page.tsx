import type { AdherenceReport, AdherenceWindow, DoseSlot, Medication, MedicationKind } from "@pulso/contract";
import { BellRing, CalendarCheck, ChartColumn, CircleCheckBig, Dumbbell, Flame, Hand, History, List, Pill, Tablets, TriangleAlert, type LucideIcon } from "lucide-react";
import { TIME } from "@/src/medication/schedule";
import { medicationPage, scheduleLine, slotLabel, unitFor, type MedicationPage } from "@/src/web/medication";
import { Card, CardTitle } from "../../_ui/card";
import { cn } from "../../_ui/cn";
import { EmptyState } from "../../_ui/empty-state";
import { fmtDayLabel, fmtLongDate, fmtNumber, fmtTime } from "../../_ui/format";
import { Page, PageHeader } from "../../_ui/page-header";
import { Ring } from "../../_ui/ring";
import { DeleteEntryButton, DoseActions, TakeOneButton } from "./_components/doses";
import { AddMedicationButton, EditMedicationRow, MedicationEditorProvider } from "./_components/editor";
import { MOMENT_ICON } from "./_components/moment-icons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Medicación y suplementos" };

const MED = "var(--domain-medication)";

const pct = (w: AdherenceWindow) => (w.rate === null ? null : Math.round(w.rate * 100));
const amount = (dose: number, unit: string) => `${fmtNumber(dose, 2)} ${unitFor(dose, unit)}`;

const KIND: Record<MedicationKind, { title: string; icon: LucideIcon }> = { medicamento: { title: "Medicamentos", icon: Pill }, suplemento: { title: "Suplementos", icon: Tablets } };

/** "a las 09:00", or the moment with its time: "con el desayuno (08:00)". */
const when = (slot: DoseSlot) => (slot.moment === "hora" || slot.moment === "entreno" ? `a las ${slot.time}` : `${slotLabel(slot.slot)} (${slot.time})`);

/** Medicación y suplementos: today's progress as the hero, the doses to tick, as-needed meds, adherence, what you take and the history. */
export default function Medicacion() {
  const page = medicationPage();
  const empty = page.medications.length === 0;
  // With only as-needed meds there is nothing to schedule or score: lead with what was taken.
  const scheduled = page.medications.some((m) => m.active && !m.schedule.asNeeded);
  return (
    <MedicationEditorProvider today={page.date}>
      <Page>
        <PageHeader eyebrow={fmtLongDate(new Date(`${page.date}T12:00:00`))} title="Medicación y suplementos" subtitle={empty ? undefined : "Marca cada toma y lleva la cuenta sin pensar."} actions={!empty && <AddMedicationButton />} />
        {empty ? (
          <Card>
            <EmptyState icon={Pill} color={MED} title="Anota tus medicamentos y suplementos" line="A una hora, con una comida o después de entrenar: Pulso te recuerda cada toma en el iPhone y lleva tu adherencia." />
            <div className="-mt-6 flex flex-wrap justify-center gap-2 pb-6">
              <AddMedicationButton label="Suplemento" kind="suplemento" prominent />
              <AddMedicationButton label="Medicamento" kind="medicamento" />
            </div>
          </Card>
        ) : (
          <>
            <Hero page={page} />
            <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {scheduled && <TodayCard page={page} delay={60} />}
              {page.asNeeded.length > 0 && <AsNeededCard page={page} delay={110} />}
              {!scheduled && <HistoryCard page={page} delay={160} />}
              {scheduled && <AdherenceCard report={page.adherence} delay={160} />}
              <MedicationsCard medications={page.medications} delay={210} />
              {scheduled && <HistoryCard page={page} delay={260} />}
            </div>
          </>
        )}
      </Page>
    </MedicationEditorProvider>
  );
}

function Hero({ page }: { page: MedicationPage }) {
  if (!page.medications.some((m) => m.active && !m.schedule.asNeeded)) return <AsNeededHero page={page} />;
  const { slots, next } = page.day;
  const taken = slots.filter((s) => s.status === "tomada").length;
  // Everything taken today, scheduled or not, newest first — as-needed doses count here too.
  const takenToday = page.history.find((d) => d.date === page.date)?.entries.filter((e) => e.status === "tomada") ?? [];
  const streak = page.adherence.overall.currentStreak;
  const low = page.medications.filter((m) => m.active && m.lowStock);
  // Just trained: what goes now leads, ahead of the next clock time.
  const afterWorkout = slots.filter((s) => s.status === "pendiente" && s.training?.state === "trained" && page.time <= s.training.until!);
  // Nothing left with a time, but something waits for today's workout.
  const waiting = slots.find((s) => s.status === "pendiente" && s.time === null);
  const headline =
    slots.length === 0
      ? "Hoy no hay tomas programadas"
      : taken === slots.length
        ? "Todo tomado por hoy"
        : afterWorkout.length
          ? `Ahora: ${new Intl.ListFormat("es").format(afterWorkout.map((s) => s.name))}, antes de las ${afterWorkout.map((s) => s.training!.until!).sort()[0]}`
          : next
          ? `Próxima: ${next.name} ${when(next)}`
          : waiting
            ? `${waiting.name}, al terminar de entrenar`
            : `${slots.length - taken} ${slots.length - taken === 1 ? "toma pendiente" : "tomas pendientes"}`;
  return (
    <Card className="relative overflow-hidden !p-6 md:!p-8">
      <div className="pointer-events-none absolute -top-32 -right-24 size-80 rounded-full opacity-[0.12] blur-3xl dark:opacity-20" style={{ background: MED }} aria-hidden />
      <div className="relative flex flex-col items-center gap-7 md:flex-row md:gap-10">
        <Ring value={slots.length ? (taken / slots.length) * 100 : null} color={MED} glow={slots.length > 0} size={184} stroke={15} label={`${takenToday.length} tomas hoy; ${taken} de ${slots.length} programadas`}>
          <div>
            <p className="tabular text-[52px] leading-none font-semibold tracking-tight">
              {takenToday.length}
            </p>
            <p className="text-muted-foreground mt-1.5 text-[12px] font-medium tracking-wide uppercase">{takenToday.length === 1 ? "Toma hoy" : "Tomas hoy"}</p>
            {slots.length > 0 && <p className="tabular text-muted-foreground mt-0.5 text-[12px]">{taken} de {slots.length} programadas</p>}
          </div>
        </Ring>
        <div className="w-full min-w-0 flex-1">
          <p className="flex items-center justify-center gap-2 text-[22px] font-semibold tracking-tight md:justify-start" style={slots.length && taken === slots.length ? { color: "var(--success)" } : undefined}>
            {slots.length > 0 && taken === slots.length ? <CircleCheckBig className="size-6" /> : afterWorkout.length ? <Dumbbell className="size-5" style={{ color: MED }} /> : next ? <BellRing className="size-5" style={{ color: MED }} /> : waiting ? <Dumbbell className="size-5" style={{ color: MED }} /> : null}
            {headline}
          </p>
          {takenToday.length > 0 && (
            <p className="text-muted-foreground mt-1.5 text-center text-[15px] md:text-left">
              Hoy: {takenToday.map((e) => `${e.name}${e.takenAt ? ` ${fmtTime(e.takenAt)}` : ""}`).join(" · ")}
            </p>
          )}
          {streak > 1 && (
            <p className="text-muted-foreground mt-1.5 flex items-center justify-center gap-1.5 text-[15px] md:justify-start">
              <Flame className="size-4" style={{ color: "var(--domain-energy)" }} />
              {streak} días seguidos sin fallar
            </p>
          )}
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <HeroTile label="Últimos 7 días" value={pct(page.adherence.overall.last7)} />
            <HeroTile label="Últimos 30 días" value={pct(page.adherence.overall.last30)} />
            <li className="bg-muted/60 col-span-2 rounded-2xl p-3.5 sm:col-span-1">
              <p className="text-muted-foreground text-[12px] font-medium">Mejor racha</p>
              <p className="tabular mt-1 text-[22px] leading-none font-semibold">
                {page.adherence.overall.bestStreak} <span className="text-muted-foreground text-[13px] font-normal">días</span>
              </p>
            </li>
          </ul>
          {low.length > 0 && (
            <p className="text-warning mt-4 flex items-center gap-1.5 text-[13px]">
              <TriangleAlert className="size-4 shrink-0" />
              Quedan pocas: {low.map((m) => `${m.name} (${m.stock})`).join(", ")}.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/** No schedules: today's count of doses taken, and the last one. */
function AsNeededHero({ page }: { page: MedicationPage }) {
  const takenToday = page.asNeeded.reduce((n, a) => n + a.today, 0);
  const today = page.history.find((d) => d.date === page.date)?.entries.filter((e) => e.status === "tomada") ?? [];
  const last = today[0];
  return (
    <Card className="relative overflow-hidden !p-6 md:!p-8">
      <div className="pointer-events-none absolute -top-32 -right-24 size-80 rounded-full opacity-[0.12] blur-3xl dark:opacity-20" style={{ background: MED }} aria-hidden />
      <div className="relative flex flex-col items-center gap-7 md:flex-row md:gap-10">
        <Ring value={takenToday > 0 ? 100 : null} color={MED} glow={takenToday > 0} size={184} stroke={15} label={`${takenToday} tomas hoy`}>
          <div>
            <p className="tabular text-[52px] leading-none font-semibold tracking-tight">{takenToday}</p>
            <p className="text-muted-foreground mt-1.5 text-[12px] font-medium tracking-wide uppercase">{takenToday === 1 ? "Toma hoy" : "Tomas hoy"}</p>
          </div>
        </Ring>
        <div className="w-full min-w-0 flex-1 text-center md:text-left">
          <p className="text-[22px] font-semibold tracking-tight">{last ? `Última: ${last.name}${last.takenAt ? ` a las ${fmtTime(last.takenAt)}` : ""}` : "Nada tomado hoy"}</p>
          <p className="text-muted-foreground mt-1.5 text-[15px]">
            {today.length > 1 ? today.map((e) => `${e.name}${e.takenAt ? ` ${fmtTime(e.takenAt)}` : ""}`).join(" · ") : "Marca «Tomé una» cada vez que tomes algo; queda en el historial."}
          </p>
        </div>
      </div>
    </Card>
  );
}

function HeroTile({ label, value }: { label: string; value: number | null }) {
  return (
    <li className="bg-muted/60 rounded-2xl p-3.5">
      <p className="text-muted-foreground text-[12px] font-medium">{label}</p>
      <p className="tabular mt-1 text-[22px] leading-none font-semibold">
        {value ?? "—"}
        {value !== null && <span className="text-muted-foreground text-[13px] font-normal"> %</span>}
      </p>
    </li>
  );
}

function TodayCard({ page, delay }: { page: MedicationPage; delay: number }) {
  const { next } = page.day;
  return (
    <Card delay={delay} className="md:col-span-2">
      <CardTitle icon={CalendarCheck} color={MED} title="Hoy" />
      {page.groups.length === 0 ? (
        <EmptyState compact icon={CalendarCheck} color={MED} title="Nada programado hoy" line="Las tomas de hoy aparecerán aquí, por momento del día, para marcarlas." />
      ) : (
        <div className="space-y-4">
          {page.groups.map((group) => {
            const Icon = MOMENT_ICON[group.moment];
            return (
              <section key={group.key}>
                <h3 className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide uppercase">
                  <Icon className="size-3.5" style={{ color: MED }} />
                  <span className={cn(group.moment === "hora" && "tabular")}>{group.title}</span>
                  {group.time && <span className="tabular font-medium normal-case">· {group.time}</span>}
                </h3>
                <ul className="-mx-2 space-y-0.5">
                  {group.slots.map((slot) => {
                    const isNext = next?.medicationId === slot.medicationId && next.slot === slot.slot;
                    const late = slot.status === "pendiente" && slot.time !== null && slot.time < page.time && slot.training?.state !== "trained";
                    return (
                      <li key={`${slot.medicationId}-${slot.slot}`} className={cn("flex min-h-14 items-center gap-3 rounded-xl px-2 py-1.5", isNext && "bg-muted/60")}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium">{slot.name}</span>
                          <span className="text-muted-foreground block truncate text-[12px]">
                            {amount(slot.dose, slot.unit)}
                            {slot.instructions && ` · ${slot.instructions}`}
                            {isNext && " · siguiente"}
                          </span>
                          {(slot.line || late) && (
                            <span className={cn("block truncate text-[12px]", late ? "text-warning" : "text-foreground/80")}>
                              {slot.line}
                              {slot.line && late && " · "}
                              {late && "se pasó la hora"}
                            </span>
                          )}
                        </span>
                        <DoseActions slot={slot} takenLabel={slot.takenAt ? fmtTime(slot.takenAt) : null} />
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function AsNeededCard({ page, delay }: { page: MedicationPage; delay: number }) {
  return (
    <Card delay={delay}>
      <CardTitle icon={Hand} color={MED} title="Cuando haga falta" />
      <ul className="-mx-2 space-y-0.5">
        {page.asNeeded.map(({ medication: m, today }) => (
          <li key={m.id} className="flex min-h-14 items-center gap-3 rounded-xl px-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{m.name}</span>
              <span className="text-muted-foreground block text-[12px]">
                {amount(m.dose, m.unit)} · {today === 0 ? "ninguna hoy" : `${today} hoy`}
              </span>
            </span>
            <TakeOneButton medicationId={m.id} date={page.date} name={m.name} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AdherenceCard({ report, delay }: { report: AdherenceReport; delay: number }) {
  const rate30 = pct(report.overall.last30);
  return (
    <Card delay={delay}>
      <CardTitle icon={ChartColumn} color={MED} title="Adherencia" />
      {report.overall.last30.due === 0 ? (
        <EmptyState compact icon={ChartColumn} color={MED} title="Todavía sin tomas que contar" line="Cuando pase la hora de alguna toma programada verás aquí cuántas cumpliste." />
      ) : (
        <>
          <div className="flex items-center gap-5">
            <Ring value={rate30} color={MED} size={96} stroke={10} label={`Adherencia de 30 días: ${rate30} %`}>
              <span className="tabular text-[22px] font-semibold">
                {rate30}
                <span className="text-muted-foreground text-[12px]">%</span>
              </span>
            </Ring>
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              <span className="text-foreground tabular font-semibold">{report.overall.last30.taken}</span> de <span className="tabular">{report.overall.last30.due}</span> tomas en los últimos 30 días.
            </p>
          </div>
          <div className="mt-5 grid grid-cols-10 gap-1" role="img" aria-label="Últimos 30 días, de más antiguo a hoy">
            {report.days.map((d) => {
              const rate = d.due ? d.taken / d.due : null;
              return (
                <span
                  key={d.date}
                  title={`${fmtDayLabel(d.date)} · ${d.due ? `${d.taken}/${d.due}` : "sin tomas"}`}
                  className="aspect-square rounded-[5px]"
                  style={{ background: rate === null ? "var(--muted)" : `color-mix(in oklab, ${MED} ${Math.round(18 + rate * 82)}%, var(--muted))` }}
                />
              );
            })}
          </div>
          <p className="text-muted-foreground mt-2 text-[11px]">Últimos 30 días · más intenso, más tomas cumplidas.</p>
          {report.medications.length > 1 && (
            <ul className="border-border mt-4 space-y-3 border-t pt-4">
              {report.medications.map((m) => {
                const r = pct(m.last30);
                return (
                  <li key={m.medicationId}>
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="truncate font-medium">{m.name}</span>
                      <span className="tabular text-muted-foreground shrink-0">
                        {r === null ? "—" : `${r} %`}
                        {m.currentStreak > 1 && ` · ${m.currentStreak} días`}
                      </span>
                    </div>
                    <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                      <div className="h-full rounded-full" style={{ width: `${r ?? 0}%`, background: MED }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function MedicationsCard({ medications, delay }: { medications: Medication[]; delay: number }) {
  const kinds = (["medicamento", "suplemento"] as const).map((kind) => ({ kind, items: medications.filter((m) => m.kind === kind) })).filter((k) => k.items.length > 0);
  return (
    <Card delay={delay}>
      <CardTitle icon={List} color={MED} title="Lo que tomas" />
      <div className="space-y-4">
        {kinds.map(({ kind, items }) => {
          const Icon = KIND[kind].icon;
          return (
            <section key={kind}>
              <h3 className="text-muted-foreground mb-1 text-[12px] font-semibold tracking-wide uppercase">{KIND[kind].title}</h3>
              <ul className="-mx-2 space-y-0.5">
                {items.map((m) => (
                  <li key={m.id}>
                    <EditMedicationRow medication={m} className="flex min-h-14 items-center gap-3 px-2 py-1.5">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${MED} 16%, transparent)`, color: MED, opacity: m.active ? 1 : 0.5 }}>
                        <Icon className="size-[18px]" />
                      </span>
                      <span className={cn("min-w-0 flex-1", !m.active && "opacity-60")}>
                        <span className="block truncate text-[14px] font-medium">
                          {m.name}
                          {!m.active && <span className="text-muted-foreground ml-1.5 text-[12px] font-normal">· en pausa</span>}
                        </span>
                        <span className="text-muted-foreground line-clamp-2 block text-[12px]">
                          {amount(m.dose, m.unit)} · {scheduleLine(m.schedule)}
                        </span>
                      </span>
                      {m.stock !== null && (
                        <span className={cn("tabular shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium", m.lowStock ? "text-warning bg-warning/12" : "text-muted-foreground bg-muted")} title={`Quedan ${m.stock} dosis`}>
                          {fmtNumber(m.stock)}
                        </span>
                      )}
                    </EditMedicationRow>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Card>
  );
}

const STATUS: Record<string, string> = { tomada: "Tomada", omitida: "Omitida", pospuesta: "Pospuesta" };

function HistoryCard({ page, delay }: { page: MedicationPage; delay: number }) {
  const taken = page.history.reduce((n, d) => n + d.entries.filter((e) => e.status === "tomada").length, 0);
  return (
    <Card delay={delay} className="md:col-span-2 xl:col-span-3">
      <CardTitle icon={History} color={MED} title="Historial" />
      {page.history.length > 0 && <p className="text-muted-foreground -mt-2 mb-3 text-[12px]">{taken} tomas en los últimos 60 días</p>}
      {page.history.length === 0 ? (
        <EmptyState compact icon={History} color={MED} title="Aún no registraste ninguna toma" line="Cada «Tomada» u «Omitir» queda aquí, agrupado por día." />
      ) : (
        <div className="max-h-[560px] space-y-5 overflow-x-hidden overflow-y-auto px-2">
          {page.history.map((day) => (
            <section key={day.date}>
              <h3 className="text-muted-foreground bg-card sticky top-0 z-[1] py-1 text-[12px] font-semibold tracking-wide uppercase">{day.date === page.date ? "Hoy" : fmtLongDate(new Date(`${day.date}T12:00:00`))}</h3>
              <ul className="-mx-2">
                {day.entries.map((e) => (
                  <li key={e.id} className="group hover:bg-muted/50 flex min-h-12 items-center gap-3 rounded-xl px-2">
                    <span className="tabular text-muted-foreground w-12 text-[13px]">{e.takenAt ? fmtTime(e.takenAt) : e.scheduledTime && TIME.test(e.scheduledTime) ? e.scheduledTime : "—"}</span>
                    <span className={cn("size-2 shrink-0 rounded-full", e.status === "tomada" ? "bg-success" : e.status === "pospuesta" ? "bg-warning" : "bg-muted-foreground/40")} />
                    <span className="min-w-0 flex-1 truncate text-[14px]">
                      <span className="font-medium">{e.name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {STATUS[e.status]}
                        {e.scheduledTime ? ` (${slotLabel(e.scheduledTime)})` : " · a demanda"} · {amount(e.dose, e.unit)}
                      </span>
                    </span>
                    <DeleteEntryButton eventId={e.id} label={e.name} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

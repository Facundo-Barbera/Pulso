import type { AdherenceReport, AdherenceWindow, Medication, MedicationKind } from "@pulso/contract";
import { AlarmClock, CalendarCheck, Check, CircleCheckBig, Dumbbell, Flame, History, List, Pill, Tablets, TrendingUp, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { cookies } from "next/headers";
import { TIME } from "@/src/medication/schedule";
import { isLeft, leftLabel, medicationPage, scheduleLine, slotLabel, unitFor, type MedicationPage, type TodayItem, type TodayState } from "@/src/web/medication";
import { Card, CardTitle } from "../../_ui/card";
import { cn } from "../../_ui/cn";
import { EmptyState } from "../../_ui/empty-state";
import { fmtDayLabel, fmtLongDate, fmtNumber, fmtTime } from "../../_ui/format";
import { Page, PageHeader } from "../../_ui/page-header";
import { Ring } from "../../_ui/ring";
import { NUDGES_COOKIE } from "./_components/cookies";
import { DeleteEntryButton, DoseActions, TakeOneButton } from "./_components/doses";
import { AddMedicationButton, EditMedicationRow, MedicationEditorProvider } from "./_components/editor";
import { ScheduleNudges } from "./_components/nudges";

export const dynamic = "force-dynamic";
export const metadata = { title: "Medicación y suplementos" };

const MED = "var(--domain-medication)";

const pct = (w: AdherenceWindow) => (w.rate === null ? null : Math.round(w.rate * 100));
const amount = (dose: number, unit: string) => `${fmtNumber(dose, 2)} ${unitFor(dose, unit)}`;
const names = (items: TodayItem[]) => new Intl.ListFormat("es").format([...new Set(items.map((i) => i.medication.name))]);

const KIND: Record<MedicationKind, { title: string; icon: LucideIcon }> = { medicamento: { title: "Medicamentos", icon: Pill }, suplemento: { title: "Suplementos", icon: Tablets } };

/** The heatmap needs this many days with scheduled doses in the last 30 to say anything. */
const HEATMAP_MIN_DAYS = 7;

/** Medicación y suplementos: what is left today as the hero, one timeline of today, schedule suggestions, constancy, what you take and the history. */
export default async function Medicacion() {
  const page = medicationPage();
  const off = (await cookies()).get(NUDGES_COOKIE)?.value.split(".") ?? [];
  const nudges = page.nudges.filter((n) => !off.includes(n.medicationId));
  const empty = page.medications.length === 0;
  const scheduled = page.medications.some((m) => m.active && !m.schedule.asNeeded);
  return (
    <MedicationEditorProvider today={page.date}>
      <Page>
        <PageHeader eyebrow={fmtLongDate(new Date(`${page.date}T12:00:00`))} title="Medicación y suplementos" actions={!empty && <AddMedicationButton />} />
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
            {nudges.length > 0 && (
              <div className="mt-5">
                <ScheduleNudges nudges={nudges} medications={page.medications} delay={40} />
              </div>
            )}
            <div className="mt-5 grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
              <TodayCard page={page} delay={60} />
              <div className="grid min-w-0 gap-5 md:col-span-2 md:grid-cols-2 xl:col-span-1 xl:grid-cols-1">
                {scheduled && <ConstancyCard report={page.adherence} delay={110} />}
                <MedicationsCard medications={page.medications} delay={160} />
              </div>
              <HistoryCard page={page} delay={210} />
            </div>
          </>
        )}
      </Page>
    </MedicationEditorProvider>
  );
}

/** What is left today, never a ratio mixing scheduled and as-needed doses. */
function Hero({ page }: { page: MedicationPage }) {
  const left = page.today.filter(isLeft);
  const taken = page.today
    .flatMap((i) => (i.state === "tomada" ? [{ name: i.medication.name, at: i.at }] : i.state === "a-demanda" ? i.intakes.map((e) => ({ name: e.name, at: e.takenAt ? fmtTime(e.takenAt) : null })) : []))
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  // The ring is the scheduled doses alone: settled (taken or skipped) out of today's.
  const slots = page.today.filter((i) => i.slot);
  const settled = slots.filter((i) => i.state === "tomada" || i.state === "omitida").length;
  const late = left.some((i) => i.state === "atrasada");
  const streak = page.adherence.overall.currentStreak;
  const low = page.medications.filter((m) => m.active && m.lowStock);
  const free = slots.length === 0 && taken.length === 0;
  const done = !left.length && !free;

  const headline = left.length ? `Te falta: ${names(left)}` : free ? "Hoy no te toca nada" : "Todo listo por hoy";
  return (
    <Card className="relative overflow-hidden !p-6 md:!p-8">
      <div className="pointer-events-none absolute -top-32 -right-24 size-80 rounded-full opacity-[0.12] blur-3xl dark:opacity-20" style={{ background: done ? "var(--state-good)" : MED }} aria-hidden />
      <div className="relative flex flex-col items-center gap-7 md:flex-row md:gap-10">
        <Ring value={slots.length ? (settled / slots.length) * 100 : taken.length ? 100 : null} color={done ? "var(--state-good)" : MED} glow={!free} size={176} stroke={14} label={left.length ? `Te faltan ${left.length}` : headline}>
          {left.length ? (
            <div>
              <p className="tabular text-[56px] leading-none font-semibold tracking-tight">{left.length}</p>
              <p className="text-muted-foreground mt-1.5 text-[12px] font-medium tracking-wide uppercase">Por tomar</p>
            </div>
          ) : (
            <div className="grid place-items-center gap-1.5">
              <Check className="size-12" strokeWidth={2.4} style={{ color: free ? "var(--muted-foreground)" : "var(--state-good)" }} />
              <p className="text-muted-foreground text-[12px] font-medium tracking-wide uppercase">{free ? "Libre" : "Listo"}</p>
            </div>
          )}
        </Ring>
        <div className="w-full min-w-0 flex-1 text-center md:text-left">
          <p className="flex items-center justify-center gap-2 text-[24px] leading-tight font-semibold tracking-tight md:justify-start" style={done ? { color: "var(--state-good)" } : undefined}>
            {done && <CircleCheckBig className="size-6 shrink-0" />}
            {headline}
          </p>
          {left.length > 0 && (
            <ul className="mt-3 flex flex-wrap justify-center gap-2 md:justify-start">
              {left.map((i) => (
                <li key={i.key} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium", i.state === "atrasada" ? "bg-caution/12 text-caution" : "bg-muted/80")}>
                  {i.state === "entreno" && <Dumbbell className="size-3.5" style={{ color: MED }} />}
                  {i.state === "dia" && <CalendarCheck className="size-3.5" style={{ color: MED }} />}
                  {i.state === "atrasada" && <AlarmClock className="size-3.5" aria-hidden />}
                  {i.medication.name}
                  <span className={cn("font-normal", i.state !== "atrasada" && "text-muted-foreground")}>
                    · {leftLabel(i)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {taken.length > 0 && <p className="text-muted-foreground mt-3 text-[15px]">Tomado hoy: {taken.map((t) => `${t.name}${t.at ? ` ${t.at}` : ""}`).join(" · ")}</p>}
          {!late && streak > 1 && (
            <p className="text-muted-foreground mt-1.5 flex items-center justify-center gap-1.5 text-[15px] md:justify-start">
              <Flame className="size-4" style={{ color: "var(--domain-energy)" }} />
              {streak} días seguidos sin fallar
            </p>
          )}
          {low.length > 0 && (
            <p className="text-warning mt-3 flex items-center justify-center gap-1.5 text-[13px] md:justify-start">
              <TriangleAlert className="size-4 shrink-0" />
              Quedan pocas: {low.map((m) => `${m.name} (${m.stock})`).join(", ")}.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

const MARKER: Record<Exclude<TodayState, "tomada" | "entreno" | "dia" | "ahora">, string> = {
  omitida: "border-muted-foreground/40 bg-muted",
  atrasada: "border-caution bg-caution/25",
  pendiente: "border-muted-foreground/50 bg-card",
  "a-demanda": "border-muted-foreground/40 border-dashed bg-card",
  "no-toca": "border-muted-foreground/25 bg-muted",
};

/** The dot on the timeline's rail, by state. */
function Marker({ state }: { state: TodayState }) {
  if (state === "tomada")
    return (
      <span className="bg-good grid size-5 place-items-center rounded-full text-white">
        <Check className="size-3" strokeWidth={3.2} />
      </span>
    );
  if (state === "entreno" || state === "dia") {
    const Icon = state === "entreno" ? Dumbbell : CalendarCheck;
    return (
      <span className="grid size-5 place-items-center rounded-full" style={{ background: `color-mix(in oklab, ${MED} 18%, var(--card))`, color: MED }}>
        <Icon className="size-3" strokeWidth={2.4} />
      </span>
    );
  }
  if (state === "ahora") return <span className="size-5 rounded-full" style={{ background: MED, boxShadow: `0 0 0 4px color-mix(in oklab, ${MED} 22%, transparent)` }} />;
  // Late reads by its clock, not only by its orange.
  if (state === "atrasada")
    return (
      <span className={cn("text-caution grid size-5 place-items-center rounded-full border-2", MARKER.atrasada)}>
        <AlarmClock className="size-2.5" strokeWidth={3} />
      </span>
    );
  return <span className={cn("size-5 rounded-full border-2", MARKER[state])} />;
}

const LINE_TONE: Partial<Record<TodayState, string>> = { atrasada: "text-caution", ahora: "text-foreground font-medium" };

const takenChip = "text-good bg-good/12 tabular rounded-full px-2.5 py-1 text-[12px] font-medium";

function TimelineRow({ item, page }: { item: TodayItem; page: MedicationPage }) {
  const m = item.medication;
  const quiet = item.state === "no-toca";
  const takenAsNeeded = item.state === "a-demanda" && item.intakes.length > 0;
  return (
    <li className="flex min-h-16 items-center gap-3 py-1.5">
      <span className={cn("tabular w-11 shrink-0 text-right text-[13px]", item.state === "atrasada" ? "text-caution font-medium" : "text-muted-foreground")}>{item.at ?? ""}</span>
      <span className="relative z-[1] grid w-5 shrink-0 place-items-center">
        <Marker state={takenAsNeeded ? "tomada" : item.state} />
      </span>
      <span className={cn("min-w-0 flex-1", quiet && "opacity-60")}>
        <span className="block truncate text-[15px] font-medium">
          {m.name} <span className="text-muted-foreground hidden text-[13px] font-normal sm:inline">· {amount(m.dose, m.unit)}</span>
        </span>
        <span className="text-muted-foreground line-clamp-2 block text-[13px] sm:truncate">
          {item.when}
          {item.state !== "tomada" && item.state !== "omitida" && !takenAsNeeded && (
            <>
              {" · "}
              <span className={LINE_TONE[item.state]}>{item.line}</span>
            </>
          )}
          {m.instructions && !quiet && <> · {m.instructions}</>}
        </span>
      </span>
      {item.slot ? (
        <DoseActions slot={item.slot} takenLabel={null} />
      ) : item.state === "a-demanda" ? (
        <span className="flex shrink-0 items-center gap-1.5">
          {takenAsNeeded && <span className={cn(takenChip, "hidden sm:inline")}>{item.line}</span>}
          <TakeOneButton medicationId={m.id} date={page.date} name={m.name} label={takenAsNeeded ? "Otra" : "Tomé una"} />
        </span>
      ) : item.state === "tomada" && item.intakes[0] ? (
        <span className="group flex shrink-0 items-center gap-1">
          <span className={takenChip}>Tomada</span>
          <DeleteEntryButton eventId={item.intakes[0].id} label={m.name} />
        </span>
      ) : null}
    </li>
  );
}

/** Today as one timeline: by the clock with a «now» mark, then what can wait and what isn't due. */
function TodayCard({ page, delay }: { page: MedicationPage; delay: number }) {
  const clock = page.today.filter((i) => i.at !== null || i.state === "entreno");
  const anyTime = page.today.filter((i) => i.state === "dia");
  const whenNeeded = page.today.filter((i) => i.state === "a-demanda" && i.at === null);
  const off = page.today.filter((i) => i.state === "no-toca");
  // «Now» sits before the first thing still ahead (a workout counts as ahead).
  const ahead = clock.findIndex((i) => i.state === "entreno" || (i.at !== null && i.at > page.time));
  const nowAt = ahead === -1 ? clock.length : ahead;
  return (
    <Card delay={delay} className="min-w-0 md:col-span-2 xl:row-span-2">
      <CardTitle icon={CalendarCheck} color={MED} title="Hoy" />
      {page.today.length === 0 ? (
        <EmptyState compact icon={CalendarCheck} color={MED} title="Nada activo" line="Activa o añade un medicamento para verlo aquí, con lo que toca y cuándo." />
      ) : (
        <div className="space-y-5">
          {clock.length > 0 && (
            <ol className="relative">
              <span className="bg-border absolute top-5 bottom-5 left-[65px] w-px" aria-hidden />
              {clock.slice(0, nowAt).map((item) => (
                <TimelineRow key={item.key} item={item} page={page} />
              ))}
              <NowMark time={page.time} />
              {clock.slice(nowAt).map((item) => (
                <TimelineRow key={item.key} item={item} page={page} />
              ))}
            </ol>
          )}
          {anyTime.length > 0 && (
            <section>
              <h3 className="text-muted-foreground text-[12px] font-semibold tracking-wide uppercase">Hoy, cuando quieras</h3>
              <ul>
                {anyTime.map((item) => (
                  <TimelineRow key={item.key} item={item} page={page} />
                ))}
              </ul>
            </section>
          )}
          {whenNeeded.length > 0 && (
            <section>
              <h3 className="text-muted-foreground text-[12px] font-semibold tracking-wide uppercase">Cuando haga falta</h3>
              <ul>
                {whenNeeded.map((item) => (
                  <TimelineRow key={item.key} item={item} page={page} />
                ))}
              </ul>
            </section>
          )}
          {off.length > 0 && (
            <section>
              <h3 className="text-muted-foreground text-[12px] font-semibold tracking-wide uppercase">Hoy no toca</h3>
              <ul>
                {off.map((item) => (
                  <TimelineRow key={item.key} item={item} page={page} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Card>
  );
}

function NowMark({ time }: { time: string }) {
  return (
    <li className="flex h-7 items-center gap-3" aria-label={`Ahora, ${time}`}>
      <span className="tabular w-11 shrink-0 text-right text-[11px] font-semibold" style={{ color: MED }}>
        Ahora
      </span>
      <span className="relative z-[1] grid w-5 place-items-center">
        <span className="size-2.5 rounded-full" style={{ background: MED }} />
      </span>
      <span className="h-px flex-1" style={{ background: `linear-gradient(to right, ${MED}, transparent)` }} />
    </li>
  );
}

/** Adherence and streak in one compact card; the heatmap once there is enough to read. */
function ConstancyCard({ report, delay }: { report: AdherenceReport; delay: number }) {
  const { overall } = report;
  const daysWithDoses = report.days.filter((d) => d.due > 0).length;
  return (
    <Card delay={delay}>
      <CardTitle icon={TrendingUp} color={MED} title="Constancia" />
      {overall.last30.due === 0 ? (
        <p className="text-muted-foreground text-[13px] leading-relaxed">Cuando pase la hora de alguna toma con horario verás aquí cuántas cumples y tu racha.</p>
      ) : (
        <>
          <ul className="grid grid-cols-3 gap-2">
            <Tile label="7 días" value={pct(overall.last7)} unit="%" />
            <Tile label="30 días" value={pct(overall.last30)} unit="%" />
            <Tile label="Racha" value={overall.currentStreak} unit={overall.currentStreak === 1 ? "día" : "días"} caption={overall.bestStreak > overall.currentStreak ? `mejor ${overall.bestStreak}` : undefined} />
          </ul>
          {daysWithDoses >= HEATMAP_MIN_DAYS ? (
            <>
              <div className="mt-4 grid grid-cols-10 gap-1" role="img" aria-label="Últimos 30 días, de más antiguo a hoy">
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
            </>
          ) : (
            <p className="text-muted-foreground mt-3 text-[12px] leading-relaxed">
              {overall.last30.taken} de {overall.last30.due} tomas cumplidas. El mapa del mes aparece tras {HEATMAP_MIN_DAYS} días con tomas.
            </p>
          )}
          {report.medications.length > 1 && (
            <ul className="border-border mt-4 space-y-2.5 border-t pt-3.5">
              {report.medications.map((m) => {
                const r = pct(m.last30);
                return (
                  <li key={m.medicationId}>
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="truncate font-medium">{m.name}</span>
                      <span className="tabular text-muted-foreground shrink-0">{r === null ? "—" : `${r} %`}</span>
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

function Tile({ label, value, unit, caption }: { label: string; value: number | null; unit: string; caption?: string }) {
  return (
    <li className="bg-muted/60 rounded-2xl p-3">
      <p className="text-muted-foreground text-[12px] font-medium">{label}</p>
      <p className="tabular mt-1 text-[20px] leading-none font-semibold">
        {value ?? "—"}
        {value !== null && <span className="text-muted-foreground text-[12px] font-normal"> {unit}</span>}
      </p>
      {caption && <p className="text-muted-foreground mt-1 text-[11px]">{caption}</p>}
    </li>
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
                        <span className={cn("tabular flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium", m.lowStock ? "text-caution bg-caution/12" : "text-muted-foreground bg-muted")} title={m.lowStock ? `Quedan pocas: ${m.stock} dosis` : `Quedan ${m.stock} dosis`}>
                          {m.lowStock && <TriangleAlert className="size-3" strokeWidth={2.4} aria-label="Quedan pocas" />}
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

/** A history entry's outcome as a shape (check, clock, cross) beside its word. */
const HISTORY_MARK: Record<string, { icon: LucideIcon; tone: string }> = {
  tomada: { icon: Check, tone: "text-good" },
  pospuesta: { icon: AlarmClock, tone: "text-caution" },
  omitida: { icon: X, tone: "text-muted-foreground" },
};

function HistoryMark({ status }: { status: string }) {
  const { icon: Icon, tone } = HISTORY_MARK[status] ?? HISTORY_MARK.omitida!;
  return <Icon className={cn("size-3.5 shrink-0", tone)} strokeWidth={2.6} aria-hidden />;
}

function HistoryCard({ page, delay }: { page: MedicationPage; delay: number }) {
  const taken = page.history.reduce((n, d) => n + d.entries.filter((e) => e.status === "tomada").length, 0);
  return (
    <Card delay={delay} className="min-w-0 md:col-span-2 xl:col-span-3">
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
                    <HistoryMark status={e.status} />
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

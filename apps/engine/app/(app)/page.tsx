import { weekStrip } from "@/src/web/calendar";
import { todayOverview } from "@/src/web/today";
import { Page, PageHeader } from "../_ui/page-header";
import { fmtLongDate, greeting } from "../_ui/format";
import { ActivityCard, BriefCard, HeartCard, MedicationCard, RecentCard, SleepCard } from "./_hoy/cards";
import { ReadinessHero } from "./_hoy/readiness-hero";
import { WeekCard } from "./_hoy/week-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hoy" };

/** Hoy: readiness as the hero, then today's supporting cards. Read-only, straight from the engine's stores. */
export default function Hoy() {
  const now = new Date();
  const today = todayOverview(now);
  return (
    <Page>
      <PageHeader eyebrow={fmtLongDate(now)} title={greeting(now)} />
      <ReadinessHero readiness={today.readiness} sleepMin={today.trend.at(-1)?.sleepMin ?? null} />
      {/* Dense so a two-column card never leaves a hole beside Corazón on a two-column screen. */}
      <div className="mt-5 grid gap-5 md:grid-flow-row-dense md:grid-cols-2 xl:grid-cols-3">
        <ActivityCard today={today.today} trend={today.trend} delay={60} />
        <SleepCard night={today.lastNight} summary={today.sleep} trend={today.trend} delay={110} />
        <HeartCard readiness={today.readiness} trend={today.trend} delay={160} />
        <BriefCard brief={today.brief} delay={210} />
        <MedicationCard day={today.medication} delay={260} />
        <WeekCard week={weekStrip(now)} delay={285} />
        <RecentCard recent={today.recent} delay={310} />
      </div>
    </Page>
  );
}

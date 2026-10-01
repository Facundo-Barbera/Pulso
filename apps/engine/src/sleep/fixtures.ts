import type { SleepSegmentInput, SleepSourceKind } from "@pulso/contract";

/** UTC−3, like Buenos Aires. */
export const TZ = -180;

/** Epoch ms of a local clock time, in minutes from midnight of `night` (negative = evening before). */
export const at = (night: string, localMin: number) => Date.parse(`${night}T00:00:00Z`) + (localMin - TZ) * 60_000;

export const addDays = (night: string, days: number) => new Date(Date.parse(`${night}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

type NightShape = { bed?: number; core?: number; deep?: number; rem?: number; awake?: number; source?: string; kind?: SleepSourceKind };

/** A synthetic watch night: 10 min awake, deep, core, REM, then the rest awake. Asleep = core + deep + rem. */
export function night(date: string, { bed = -60, core = 270, deep = 80, rem = 110, awake = 20, source = "Apple Watch", kind = "watch" }: NightShape = {}): SleepSegmentInput[] {
  const parts: [SleepSegmentInput["stage"], number][] = [["awake", 10], ["deep", deep], ["core", core], ["rem", rem], ["awake", awake - 10]];
  let t = bed;
  return parts
    .filter(([, len]) => len > 0)
    .map(([stage, len]) => {
      const segment = { start: at(date, t), end: at(date, t + len), stage, source, sourceKind: kind, tzOffsetMin: TZ };
      t += len;
      return segment;
    });
}

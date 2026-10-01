import type { BusyBlock } from "@pulso/contract";
import { addDays, isoWeekday } from "./time";

/** One day of a busy block. Timed occurrences have `start`/`end` ("HH:MM"). */
export type Occurrence = {
  blockId: string;
  title: string;
  date: string;
  allDay: boolean;
  start: string | null;
  end: string | null;
  source: BusyBlock["source"];
};

type Expandable = Pick<BusyBlock, "id" | "title" | "allDay" | "date" | "endDate" | "start" | "end" | "weekdays" | "until" | "source">;

/** Whether `block` happens on `date`. */
export function occursOn(block: Expandable, date: string): boolean {
  if (date < block.date) return false;
  if (block.weekdays.length > 0) return (!block.until || date <= block.until) && block.weekdays.includes(isoWeekday(date));
  return date <= (block.endDate ?? block.date);
}

/** Every day of every block in [from, to], sorted by date then start. */
export function expand(blocks: Expandable[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const block of blocks) {
    const last = block.weekdays.length > 0 ? (block.until ?? to) : (block.endDate ?? block.date);
    const first = block.date > from ? block.date : from;
    for (let date = first; date <= to && date <= last; date = addDays(date, 1)) {
      if (!occursOn(block, date)) continue;
      out.push({ blockId: block.id, title: block.title, date, allDay: block.allDay, start: block.start, end: block.end, source: block.source });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? ""));
}

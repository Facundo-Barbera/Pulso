"use client";

import type { Medication, ScheduleNudge } from "@pulso/contract";
import { CalendarClock, CalendarSync } from "lucide-react";
import { useState } from "react";
import { Card } from "../../../_ui/card";
import { Button } from "../../../_ui/fields";
import { NUDGES_COOKIE } from "./cookies";
import { useMedicationEditor } from "./editor";

const MED = "var(--domain-medication)";

/**
 * Quiet suggestions to schedule as-needed meds taken on a rhythm. «Ponerle
 * horario» opens the editor prefilled; «Ahora no» hides it on this browser.
 */
export function ScheduleNudges({ nudges, medications, delay }: { nudges: ScheduleNudge[]; medications: Medication[]; delay: number }) {
  const open = useMedicationEditor();
  const [hidden, setHidden] = useState<string[]>([]);
  const shown = nudges.filter((n) => !hidden.includes(n.medicationId));
  if (shown.length === 0) return null;

  function dismiss(id: string) {
    const off = document.cookie.match(new RegExp(`${NUDGES_COOKIE}=([^;]*)`))?.[1]?.split(".").filter(Boolean) ?? [];
    document.cookie = `${NUDGES_COOKIE}=${[...new Set([...off, id])].join(".")}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setHidden((h) => [...h, id]);
  }

  return (
    <Card delay={delay} className="!py-4">
      <ul className="divide-border divide-y">
        {shown.map((n) => {
          const med = medications.find((m) => m.id === n.medicationId);
          const Icon = n.cadence === "weekly" ? CalendarSync : CalendarClock;
          return (
            <li key={n.medicationId} className="flex flex-col gap-3 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${MED} 14%, transparent)`, color: MED }}>
                  <Icon className="size-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium">{n.title}</span>
                  <span className="text-muted-foreground block text-[13px]">{n.detail}</span>
                </span>
              </span>
              <span className="flex shrink-0 gap-1.5 self-end sm:self-auto">
                <Button variant="ghost" onClick={() => dismiss(n.medicationId)} className="min-h-9 px-3 text-[13px]">
                  Ahora no
                </Button>
                {med && (
                  <Button onClick={() => open(med, med.kind, { schedule: n.schedule, instructions: n.instructions })} className="min-h-9 px-3.5 text-[13px]">
                    Ponerle horario
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

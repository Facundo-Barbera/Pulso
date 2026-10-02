import type { NutrientZone } from "@pulso/contract";
import type { LucideIcon } from "lucide-react";
import { fmtNumber } from "../../../_ui/format";
import { zoneFraction, zoneTop } from "./zone";

const STRIPES = "repeating-linear-gradient(135deg, var(--state-caution) 0 2px, color-mix(in oklab, var(--state-caution) 30%, transparent) 2px 5px)";

/**
 * One ring in the manner of Apple's Activity rings: a tinted track, the arc from
 * 12 o'clock with the icon centred on its start, and past a full lap a lighter second
 * lap whose end casts a crisp shadow on the first. `children` sit in the hole.
 * Server-rendered; the first lap sweeps in once (off for reduced motion).
 */
export function ActivityRing({ progress, color, Icon, size, stroke, label, children }: { progress: number; color: string; Icon: LucideIcon; size: number; stroke: number; label: string; children?: React.ReactNode }) {
  const c = size / 2;
  const r = c - stroke / 2;
  const circumference = 2 * Math.PI * r;
  const lap = Math.min(progress, 1);
  const second = Math.min(Math.max(progress - 1, 0), 1);
  const point = (f: number) => ({ x: c + r * Math.cos(f * 2 * Math.PI), y: c + r * Math.sin(f * 2 * Math.PI) });
  const end = point(second);
  // The shadow sits a hair ahead of the overflow's end; the overflow arc covers the rest of it.
  const shade = point(second + 2.5 / circumference);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} shapeRendering="geometricPrecision" aria-hidden>
        <g transform={`rotate(-90 ${c} ${c})`}>
          <circle className="activity-track" cx={c} cy={c} r={r} fill="none" stroke={color} strokeOpacity={0.22} strokeWidth={stroke} />
          {lap > 0 && (
            <circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - lap)}
              className="motion-safe:animate-[pulso-ring_1100ms_cubic-bezier(.2,.7,.2,1)_both]"
              style={{ "--ring-circumference": circumference } as React.CSSProperties}
            />
          )}
          {second > 0 && (
            <>
              <circle cx={shade.x} cy={shade.y} r={stroke / 2 + 1.5} fill="rgb(0 0 0 / 0.5)" />
              <circle cx={end.x} cy={end.y} r={stroke / 2} fill={`color-mix(in oklab, ${color} 80%, white)`} />
              <circle cx={c} cy={c} r={r} fill="none" stroke={`color-mix(in oklab, ${color} 80%, white)`} strokeWidth={stroke} strokeDasharray={`${second * circumference} ${circumference}`} />
            </>
          )}
        </g>
      </svg>
      <span className="absolute left-1/2 top-0 grid -translate-x-1/2 place-items-center" style={{ width: stroke, height: stroke }} aria-hidden>
        <Icon style={{ width: stroke * 0.58, height: stroke * 0.58, color: progress > 0 ? "rgb(0 0 0 / 0.78)" : color }} strokeWidth={2.75} />
      </span>
      <div className="absolute grid place-items-center text-center" style={{ inset: stroke + 4 }}>
        {children}
      </div>
    </div>
  );
}

/** A small label centred on `pct` of the bar, kept inside it. */
function BarLabel({ pct, top, className, children }: { pct: number; top: number; className: string; children: React.ReactNode }) {
  return (
    <span className={`tabular absolute w-16 text-center leading-none whitespace-nowrap ${className}`} style={{ top, left: `clamp(-8px, calc(${pct * 100}% - 32px), calc(100% - 56px))` }}>
      {children}
    </span>
  );
}

/**
 * A progress bar that knows the zone: filled from 0 to what you've had (where you
 * are), the zone as a lighter, taller band behind it with its numbers underneath,
 * the target as a tick labelled «meta», and anything past the zone striped in the
 * caution colour after a small gap at the max.
 */
export function ZoneBar({ zone, color }: { zone: NutrientZone; color: string }) {
  const at = (v: number) => zoneFraction(zone, v);
  const low = at(zone.min ?? 0);
  const high = zone.kind === "min" ? 1 : at(zone.max ?? zoneTop(zone));
  const overAt = zone.kind === "min" || zone.max === null ? null : at(zone.max);
  const value = at(zone.value);
  const fill = overAt === null ? value : Math.min(value, overAt);
  const numbers = zone.kind === "min" || zone.max === null ? `≥ ${fmtNumber(zone.min ?? 0)}` : zone.min === null ? `≤ ${fmtNumber(zone.max)}` : `${fmtNumber(zone.min)}–${fmtNumber(zone.max)}`;
  const pct = (f: number) => `${f * 100}%`;
  return (
    <div className="relative h-10" aria-hidden>
      <BarLabel pct={at(zone.target)} top={0} className="text-foreground text-[9px] font-semibold">
        meta
      </BarLabel>
      <div className="zone-band absolute top-[9px] h-[18px] rounded-[4px]" style={{ left: pct(low), width: `max(6px, ${pct(high - low)})`, background: `color-mix(in oklab, ${color} 35%, transparent)` }} />
      <div className="absolute inset-x-0 top-[13px] h-2.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--foreground)_12%,transparent)]">
        {fill > 0 && <div className="absolute inset-y-0 left-0 min-w-2.5 rounded-full" style={{ width: pct(fill), background: color }} />}
        {overAt !== null && value > overAt && (
          <>
            <div className="absolute inset-y-0" style={{ left: pct(overAt), width: pct(value - overAt), background: STRIPES }} />
            <div className="absolute inset-y-0 w-[2.5px] -translate-x-1/2 bg-[var(--card)]" style={{ left: pct(overAt) }} />
          </>
        )}
      </div>
      <div className="zone-mark bg-foreground absolute top-[9px] h-[18px] w-[2.5px] -translate-x-1/2 rounded-full" style={{ left: pct(at(zone.target)) }} />
      <BarLabel pct={(low + high) / 2} top={30} className="text-muted-foreground text-[10px]">
        {numbers}
      </BarLabel>
    </div>
  );
}

/** «▬ lo que llevas · ░ tu zona · ┃ tu meta · ▨ de más», drawn with the bar's own marks. */
export function BarLegend() {
  return (
    <p className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11.5px]">
      <span className="flex items-center gap-1.5">
        <span className="bg-foreground/70 h-2 w-4 rounded-full" />
        lo que llevas
      </span>
      <span className="flex items-center gap-1.5">
        <span className="bg-foreground/25 h-3 w-4 rounded-[3px]" />
        tu zona
      </span>
      <span className="flex items-center gap-1.5">
        <span className="bg-foreground h-3.5 w-[2.5px] rounded-full" />
        tu meta
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-4 rounded-full" style={{ background: STRIPES }} />
        de más
      </span>
    </p>
  );
}

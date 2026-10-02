import type { NutrientZone } from "@pulso/contract";
import type { LucideIcon } from "lucide-react";
import { zoneFraction } from "./zone";

export type RingSpec = {
  key: string;
  color: string;
  Icon: LucideIcon;
  /** Progress toward the target: 1 is a full lap (100 %), past 1 it goes round again. */
  progress: number;
};

/**
 * Concentric rings in the manner of Apple's Activity rings, outermost first, and
 * only that: progress toward each target, one stroke width, tight gaps, the icon at
 * each ring's start so identity reads from the icon and the order, not the hue, and
 * past 100 % a second lap whose end casts a shadow. The zone lives in ZoneBar.
 * Server-rendered; the first lap sweeps in once (off for reduced motion).
 */
export function ActivityRings({ rings, size, stroke, gap, label }: { rings: RingSpec[]; size: number; stroke: number; gap: number; label: string }) {
  const c = size / 2;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible" aria-hidden>
        <g transform={`rotate(-90 ${c} ${c})`}>
          {rings.map((ring, i) => (
            <Ring key={ring.key} ring={ring} c={c} r={c - stroke / 2 - i * (stroke + gap)} stroke={stroke} />
          ))}
        </g>
      </svg>
      {rings.map(({ key, Icon, color, progress }, i) => (
        <span key={key} className="absolute left-1/2 grid -translate-x-1/2 place-items-center" style={{ top: i * (stroke + gap), width: stroke, height: stroke }} aria-hidden>
          <Icon style={{ width: stroke * 0.56, height: stroke * 0.56, color: progress > 0 ? "rgb(0 0 0 / 0.78)" : color }} strokeWidth={2.75} />
        </span>
      ))}
    </div>
  );
}

function Ring({ ring, c, r, stroke }: { ring: RingSpec; c: number; r: number; stroke: number }) {
  const { color, progress } = ring;
  const circumference = 2 * Math.PI * r;
  const lap = Math.min(progress, 1);
  const second = Math.min(Math.max(progress - 1, 0), 1);
  const point = (f: number) => ({ x: c + r * Math.cos(f * 2 * Math.PI), y: c + r * Math.sin(f * 2 * Math.PI) });
  const start = point(0);
  const end = point(second);

  return (
    <g>
      <circle className="activity-track" cx={c} cy={c} r={r} fill="none" stroke={color} strokeOpacity={0.22} strokeWidth={stroke} />
      {lap > 0 && (
        <>
          <circle cx={start.x} cy={start.y} r={stroke / 2} fill={color} />
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
        </>
      )}
      {second > 0 && (
        <>
          <circle cx={end.x} cy={end.y} r={stroke / 2} fill={color} style={{ filter: `drop-shadow(0 0 ${stroke / 4}px rgb(0 0 0 / 0.6))` }} />
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={`color-mix(in oklab, ${color} 88%, white)`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${second * circumference} ${circumference}`}
          />
        </>
      )}
    </g>
  );
}

/**
 * A zone as a line, which reads far better than marks on an arc: a thin neutral
 * track, the zone as a thicker, lighter stretch of the nutrient's colour, a tick at
 * the target and a dot at today's value.
 */
export function ZoneBar({ zone, color }: { zone: NutrientZone; color: string }) {
  const pct = (v: number) => `${zoneFraction(zone, v) * 100}%`;
  const low = zoneFraction(zone, zone.min ?? 0);
  const high = zoneFraction(zone, zone.max ?? zone.target);
  return (
    <div className="relative h-4" aria-hidden>
      <div className="zone-track absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[color-mix(in_oklab,var(--foreground)_14%,transparent)]" />
      <div className="absolute top-1/2 h-2.5 min-w-2 -translate-y-1/2 rounded-full" style={{ left: `${low * 100}%`, width: `${(high - low) * 100}%`, background: `color-mix(in oklab, ${color} 45%, transparent)` }} />
      <div className="zone-mark bg-foreground absolute top-0 h-4 w-[2.5px] -translate-x-1/2 rounded-full" style={{ left: pct(zone.target) }} />
      <div
        className="absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full border-[2.5px] border-[var(--card)] transition-[left] duration-500"
        style={{ left: `clamp(0px, calc(${pct(zone.value)} - 7px), calc(100% - 14px))`, background: color }}
      />
    </div>
  );
}

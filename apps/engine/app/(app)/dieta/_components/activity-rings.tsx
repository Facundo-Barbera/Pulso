import type { NutrientZone } from "@pulso/contract";
import type { LucideIcon } from "lucide-react";
import { ringFull } from "./zone";

export type RingSpec = {
  key: string;
  color: string;
  Icon: LucideIcon;
  /** Laps: 1 is a full circle, past 1 it goes round again. */
  progress: number;
  zone: NutrientZone | null;
};

/** Where a value sits on its ring, in laps: against the zone's ring when there is one, else against the target. */
export const ringLaps = (value: number, zone: NutrientZone | null, target: number | null | undefined) =>
  Math.max(0, zone ? value / ringFull(zone) : target ? value / target : 0);

/**
 * Concentric rings in the manner of Apple's Activity rings, outermost first: one
 * stroke width, tight gaps, each with its icon at its start so identity reads from
 * the icon and the order, not the hue. Past a lap the ring goes round again and the
 * second lap's end casts a shadow on the first. A zone shows without colour: the
 * unfilled track between min and max is hatched, both ends are cut like brackets,
 * the target is a notched tick, and the arc past the max is hatched. Server-rendered;
 * the first lap sweeps in once (off for reduced motion).
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
  const { color, progress, zone } = ring;
  const circumference = 2 * Math.PI * r;
  const lap = Math.min(progress, 1);
  const second = Math.min(Math.max(progress - 1, 0), 1);
  const full = zone ? ringFull(zone) : 1;
  const at = (v: number) => v / full;
  const min = zone?.min != null ? at(zone.min) : null;
  const max = zone?.max != null ? at(zone.max) : null;
  const target = zone ? at(zone.target) : null;
  const point = (f: number, d: number) => ({ x: c + d * Math.cos(f * 2 * Math.PI), y: c + d * Math.sin(f * 2 * Math.PI) });
  // A segment from fraction a to b of the circle.
  const seg = (a: number, b: number) => ({ strokeDasharray: `${Math.max(0, b - a) * circumference} ${circumference}`, strokeDashoffset: -a * circumference });
  const tick = (f: number, half: number) => {
    const [p, q] = [point(f, r - half), point(f, r + half)];
    return { x1: p.x, y1: p.y, x2: q.x, y2: q.y };
  };
  // Short radial stripes every ~5px of arc between a and b.
  const hatch = (a: number, b: number) => {
    const n = Math.floor(((b - a) * circumference) / 5);
    return Array.from({ length: Math.max(0, n) }, (_, k) => tick(a + ((k + 0.5) * (b - a)) / n, stroke * 0.3));
  };
  const band = zone ? { from: Math.min(min ?? 0, 1), to: Math.min(max ?? target!, 1) } : null;
  const notch = (f: number) => {
    const rim = r + stroke / 2;
    const spread = (stroke * 0.32) / rim;
    const [a, tip, b] = [point(f - spread / (2 * Math.PI), rim), point(f, rim - stroke * 0.38), point(f + spread / (2 * Math.PI), rim)];
    return `${a.x},${a.y} ${tip.x},${tip.y} ${b.x},${b.y}`;
  };
  const start = point(0, r);
  const end = point(second, r);

  return (
    <g>
      <circle className="activity-track" cx={c} cy={c} r={r} fill="none" stroke={color} strokeOpacity={0.22} strokeWidth={stroke} />
      {band && (
        <>
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--foreground)" strokeOpacity={0.1} strokeWidth={stroke} {...seg(band.from, band.to)} />
          {lap < band.to && hatch(Math.max(band.from, lap), band.to).map((l, k) => <line key={k} className="zone-hatch" {...l} stroke="var(--foreground)" strokeOpacity={0.45} strokeWidth={1.5} />)}
        </>
      )}
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
          <circle cx={c} cy={c} r={r} fill="none" stroke={`color-mix(in oklab, ${color} 88%, white)`} strokeWidth={stroke} strokeLinecap="round" {...seg(0, second)} />
        </>
      )}
      {max !== null && progress > max &&
        [...hatch(Math.min(max, 1), lap), ...(second > 0 ? hatch(0, second) : [])].map((l, k) => <line key={`o${k}`} {...l} stroke="black" strokeOpacity={0.32} strokeWidth={1.5} />)}
      {[min, max].map((f, k) => f !== null && f > 0 && f < 1 && <line key={`b${k}`} className="zone-mark" {...tick(f, stroke / 2)} stroke="var(--card)" strokeWidth={2} />)}
      {target !== null && target < 1 && (
        <>
          <line {...tick(target, stroke / 2)} stroke="var(--card)" strokeWidth={6} />
          <line className="zone-mark" {...tick(target, stroke / 2 - 1)} stroke="var(--foreground)" strokeWidth={2.5} strokeLinecap="round" />
          <polygon className="zone-mark" points={notch(target)} fill="var(--foreground)" />
        </>
      )}
    </g>
  );
}

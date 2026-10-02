import type { NutrientZone } from "@pulso/contract";
import { ringFull } from "./zone";

/**
 * A ring that knows the target zone: the track carries a soft green band from
 * the zone's min to its max and a tick at the target; the progress arc is the
 * nutrient's colour below the zone, success green (with a glow) inside it, and
 * past the max the overflow turns destructive. Server-rendered; the arc sweeps
 * in once (off for reduced motion).
 */
export function ZoneRing({ zone, size, stroke, color, glow = false, label, children }: { zone: NutrientZone; size: number; stroke: number; color: string; glow?: boolean; label: string; children?: React.ReactNode }) {
  const c = size / 2;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const full = ringFull(zone);
  const at = (v: number) => Math.max(0, Math.min(1, v / full));
  const progress = at(zone.value);
  const over = zone.status === "above" && zone.max !== null ? at(zone.max) : null;
  const tone = zone.status === "inZone" ? "var(--success)" : color;
  const angle = at(zone.target) * 2 * Math.PI;
  const tick = (d: number) => ({ x: c + d * Math.cos(angle), y: c + d * Math.sin(angle) });
  const inner = tick(r - stroke / 2 - 2);
  const outer = tick(r + stroke / 2 + 2);
  // A segment from fraction a to b of the circle.
  const arc = (a: number, b: number) => ({ strokeDasharray: `${(b - a) * circumference} ${circumference}`, strokeDashoffset: -a * circumference });

  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={label}>
      {glow && <div className="absolute inset-[12%] rounded-full opacity-40 blur-2xl transition-colors duration-500" style={{ background: tone }} aria-hidden />}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="relative -rotate-90 overflow-visible">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle cx={c} cy={c} r={r} fill="none" stroke="color-mix(in oklab, var(--success) 42%, transparent)" strokeWidth={stroke} {...arc(at(zone.min ?? 0), at(zone.max ?? zone.target))} />
        {progress > 0 && (
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - (over ?? progress))}
            className="transition-[stroke] duration-500 motion-safe:animate-[pulso-ring_1100ms_cubic-bezier(.2,.7,.2,1)_both]"
            style={{ "--ring-circumference": circumference, filter: zone.status === "inZone" ? `drop-shadow(0 0 ${stroke / 2}px color-mix(in oklab, var(--success) 55%, transparent))` : undefined } as React.CSSProperties}
          />
        )}
        {over !== null && (
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--destructive)" strokeWidth={stroke} strokeLinecap="round" {...arc(over, progress)} />
        )}
        <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="var(--foreground)" strokeOpacity={0.75} strokeWidth={Math.max(2, stroke / 6)} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

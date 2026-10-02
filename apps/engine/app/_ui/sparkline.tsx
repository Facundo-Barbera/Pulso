"use client";

import { useId, useState } from "react";
import { cn } from "./cn";
import { fmtMinutes } from "./format";

export type Point = { label: string; value: number | null };

/**
 * A small chart for a trend: a line with a soft area under it, or bars. The
 * time axis is the whole window (one slot per point), so empty days read as
 * empty rather than shifting the rest. On a line, a gap between readings is
 * bridged with a dashed segment over one continuous area, and a lone reading
 * gets a dot: never a sliver.
 * Hovering, touching or arrow keys read a point out in the header; otherwise
 * the header names the window (`range`) and the dashed `target` line
 * (`targetLabel`, e.g. "media 43 ms"). The first and last labels sit under it.
 * Labels come preformatted from the server, so nothing depends on the
 * browser's timezone.
 */
export function Sparkline({
  points,
  color,
  variant = "line",
  height = 56,
  unit,
  decimals = 0,
  duration = false,
  target,
  targetLabel,
  band,
  range,
  axis = true,
  grow = false,
  className,
  label,
}: {
  points: Point[];
  color: string;
  variant?: "line" | "bars";
  height?: number;
  unit?: string;
  decimals?: number;
  /** values are minutes; read out as "6 h 20 min", like everywhere else */
  duration?: boolean;
  target?: number;
  targetLabel?: string;
  /** the range where a value is on track (a target zone): tinted with the "good" state and edged, so it reads without hue */
  band?: { min: number; max: number };
  range?: string;
  axis?: boolean;
  /** fill the parent's height (at least `height`), for a chart that should take up its card's free space */
  grow?: boolean;
  className?: string;
  label: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length === 0) return null;

  const W = 100;
  const H = height;
  const pad = 5;
  const n = points.length;
  const bars = variant === "bars";
  const hi = Math.max(...values, target ?? -Infinity, band?.max ?? -Infinity);
  const lo = Math.min(...values, target ?? Infinity, band?.min ?? Infinity);
  // Lines get headroom both ways so a flat week doesn't hug an edge; bars start at zero.
  const room = (hi - lo || Math.abs(hi) || 1) * 0.12;
  const max = hi + (bars ? hi * 0.06 : room);
  const min = bars ? 0 : lo - room;
  const x = (i: number) => (bars ? ((i + 0.5) * W) / n : n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (H - pad * 2);
  const format = (v: number) => (duration ? fmtMinutes(v) : `${v.toLocaleString("es", { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${unit ? ` ${unit}` : ""}`);

  // Readings in order; consecutive days form solid runs, the jumps between runs are bridges.
  const present = points.flatMap((p, i) => (p.value === null ? [] : [{ i, v: p.value }]));
  const runs: (typeof present)[] = [];
  for (const p of present) {
    const run = runs.at(-1);
    if (run && run.at(-1)!.i === p.i - 1) run.push(p);
    else runs.push([p]);
  }
  const bridges = runs.slice(1).map((run, k) => [runs[k]!.at(-1)!, run[0]!] as const);
  const lone = runs.filter((run) => run.length === 1).map((run) => run[0]!);

  const last = present.at(-1)!;
  const shown = hover !== null ? points[hover]! : null;
  const marker = hover !== null ? (points[hover]!.value === null ? null : { i: hover, v: points[hover]!.value! }) : last;
  const barWidth = (W / n) * 0.62;
  const pick = (clientX: number, rect: DOMRect) => {
    const ratio = (clientX - rect.left) / rect.width;
    const i = bars ? Math.floor(ratio * n) : Math.round(ratio * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className={cn("relative min-w-0 select-none", grow && "flex flex-col", className)}>
      <div className="text-muted-foreground mb-1.5 flex h-4 items-center justify-between gap-2 text-[11px] whitespace-nowrap tabular">
        {shown ? (
          <span className="truncate">
            {shown.label} · <span className="text-foreground font-medium">{shown.value === null ? "sin datos" : format(shown.value)}</span>
          </span>
        ) : (
          <>
            <span className="truncate">{range}</span>
            {target !== undefined ? (
              <span className="flex shrink-0 items-center gap-1">
                <span className="w-3 border-t border-dashed border-current opacity-70" aria-hidden />
                {targetLabel ?? format(target)}
              </span>
            ) : (
              band && (
                <span className="flex shrink-0 items-center gap-1">
                  <span className="border-good/60 bg-good/15 h-2 w-3 border-y" aria-hidden />
                  {targetLabel ?? `zona ${format(band.min)}–${format(band.max)}`}
                </span>
              )
            )}
          </>
        )}
      </div>
      <div className={cn("relative", grow && "flex-1")} style={{ minHeight: H }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className={cn("focus-visible:ring-ring block w-full touch-none overflow-visible rounded-sm outline-none focus-visible:ring-2", grow && "absolute inset-0 h-full")}
          style={grow ? undefined : { height: H }}
          role="img"
          aria-label={label}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const step = e.key === "ArrowLeft" ? -1 : 1;
            setHover((h) => Math.max(0, Math.min(n - 1, (h ?? n - 1) + (h === null ? 0 : step))));
          }}
        >
          <defs>
            <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.26" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {band && (
            <g>
              <rect className="zone-band" x="0" width={W} y={y(band.max)} height={Math.max(0.5, y(band.min) - y(band.max))} fill="var(--state-good)" fillOpacity="0.12" />
              {[band.max, band.min].map((v, i) => (
                <line key={i} className="zone-band-edge" x1="0" x2={W} y1={y(v)} y2={y(v)} stroke="var(--state-good)" strokeOpacity="0.5" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          )}
          {bars && <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeOpacity="0.2" vectorEffect="non-scaling-stroke" />}
          {target !== undefined && <line x1="0" x2={W} y1={y(target)} y2={y(target)} stroke="var(--muted-foreground)" strokeOpacity="0.55" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
          {bars ? (
            points.map((p, i) =>
              p.value === null ? null : (
                <rect
                  key={i}
                  x={x(i) - barWidth / 2}
                  y={y(p.value)}
                  width={barWidth}
                  height={Math.max(1.5, y(0) - y(p.value))}
                  rx="1"
                  fill={color}
                  opacity={hover === null ? (i === last.i ? 1 : 0.5) : hover === i ? 1 : 0.25}
                />
              ),
            )
          ) : (
            <>
              {/* One area under every reading, across gaps too: per-run areas read as broken pieces. */}
              {present.length > 1 && (
                <path d={`${present.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join(" ")} L${x(last.i)},${H} L${x(present[0]!.i)},${H} Z`} fill={`url(#${id}a)`} />
              )}
              {bridges.map(([a, b], k) => (
                <line key={k} x1={x(a.i)} y1={y(a.v)} x2={x(b.i)} y2={y(b.v)} stroke={color} strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="2 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              ))}
              {runs.map((run, r) =>
                run.length < 2 ? null : (
                  <path key={r} d={run.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                ),
              )}
              {hover !== null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="var(--muted-foreground)" strokeOpacity="0.35" vectorEffect="non-scaling-stroke" />}
            </>
          )}
        </svg>
        {/* Dots are HTML so they stay round when the chart stretches. */}
        {!bars &&
          lone
            .filter((p) => p.i !== marker?.i)
            .map((p) => <span key={p.i} className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${x(p.i)}%`, top: `${(y(p.v) / H) * 100}%`, background: color }} aria-hidden />)}
        {!bars && marker && (
          <span
            className="border-card pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 box-content"
            style={{ left: `${x(marker.i)}%`, top: `${(y(marker.v) / H) * 100}%`, background: color }}
            aria-hidden
          />
        )}
      </div>
      {axis && n > 1 && (
        <div className="text-muted-foreground/80 mt-1 flex justify-between text-[10px] tabular">
          <span>{points[0]!.label}</span>
          <span>{points.at(-1)!.label}</span>
        </div>
      )}
    </div>
  );
}

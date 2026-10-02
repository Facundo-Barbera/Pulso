"use client";

import { useId, useState } from "react";
import { cn } from "./cn";

export type Point = { label: string; value: number | null };

/**
 * A small chart for a trend: a line with a soft area under it, or bars. No
 * axes, no grid. Hovering (or touching) reads the point out above the chart.
 * Gaps (null) break the line rather than inventing values. Labels come
 * preformatted from the server, so nothing depends on the browser's timezone.
 * `band` tints the range where a value is on track (a target zone) in success green.
 */
export function Sparkline({ points, color, variant = "line", height = 56, unit, decimals = 0, target, band, className, label }: { points: Point[]; color: string; variant?: "line" | "bars"; height?: number; unit?: string; decimals?: number; target?: number; band?: { min: number; max: number }; className?: string; label: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length === 0) return null;

  const W = 100;
  const H = height;
  const pad = 4;
  const max = Math.max(...values, target ?? -Infinity, band?.max ?? -Infinity);
  const min = variant === "bars" ? 0 : Math.min(...values, target ?? Infinity, band?.min ?? Infinity);
  const span = max - min || 1;
  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - pad * 2);
  const format = (v: number) => `${v.toLocaleString("es", { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${unit ? ` ${unit}` : ""}`;

  // Runs of consecutive values: a gap starts a new segment.
  const segments: { i: number; v: number }[][] = [];
  points.forEach((p, i) => {
    if (p.value === null) return;
    const last = segments.at(-1);
    if (last && last.at(-1)!.i === i - 1) last.push({ i, v: p.value });
    else segments.push([{ i, v: p.value }]);
  });

  const shown = hover !== null ? points[hover] : null;
  const barWidth = (W / points.length) * 0.62;

  return (
    <div className={cn("relative select-none", className)}>
      <div className="text-muted-foreground mb-1 flex h-4 items-center justify-end text-[11px] tabular">
        {shown && (
          <span>
            {shown.label} · <span className="text-foreground font-medium">{shown.value === null ? "sin datos" : format(shown.value)}</span>
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block w-full touch-none overflow-visible"
        style={{ height: H }}
        role="img"
        aria-label={label}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          const i = variant === "bars" ? Math.floor(ratio * points.length) : Math.round(ratio * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {band && <rect x="0" width={W} y={y(band.max)} height={Math.max(0.5, y(band.min) - y(band.max))} fill="var(--success)" fillOpacity="0.12" />}
        {target !== undefined && <line x1="0" x2={W} y1={y(target)} y2={y(target)} stroke="var(--muted-foreground)" strokeOpacity="0.45" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        {variant === "bars"
          ? points.map((p, i) =>
              p.value === null ? null : (
                <rect
                  key={i}
                  x={((i + 0.5) * W) / points.length - barWidth / 2}
                  y={y(p.value)}
                  width={barWidth}
                  height={Math.max(1.5, H - pad - y(p.value))}
                  rx="1.2"
                  fill={color}
                  opacity={hover === null || hover === i ? (i === points.length - 1 ? 1 : 0.55) : 0.25}
                />
              ),
            )
          : segments.map((segment, s) => {
              const line = segment.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join(" ");
              const area = `${line} L${x(segment.at(-1)!.i)},${H} L${x(segment[0]!.i)},${H} Z`;
              return (
                <g key={s}>
                  {segment.length > 1 && <path d={area} fill={`url(#${id}a)`} />}
                  <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
        {variant === "line" && hover !== null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="var(--muted-foreground)" strokeOpacity="0.35" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* The point marker is HTML so it stays round when the chart stretches. */}
      {variant === "line" &&
        (() => {
          const i = hover ?? points.findLastIndex((p) => p.value !== null);
          const v = points[i]?.value;
          if (v == null) return null;
          return (
            <span
              className="border-card pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
              style={{ left: `${x(i)}%`, top: 20 + (y(v) / H) * H, background: color }}
              aria-hidden
            />
          );
        })()}
    </div>
  );
}

import type { Muscle } from "@pulso/contract";
import { cn } from "../../../_ui/cn";
import { BACK, BODY_SIZE, FRONT, type BodyPolygon } from "./body-map-data";

/** Strong for primary, softer for secondary: the same pairing as the phone's MuscleMapView. */
export const PRIMARY = "var(--domain-protein)";
export const SECONDARY = "var(--domain-carbs)";

export const MUSCLE_ES: Record<Muscle, string> = {
  chest: "Pecho",
  front_delts: "Deltoides anterior",
  side_delts: "Deltoides lateral",
  rear_delts: "Deltoides posterior",
  traps: "Trapecio",
  upper_back: "Espalda alta",
  lats: "Dorsales",
  lower_back: "Lumbares",
  biceps: "Bíceps",
  triceps: "Tríceps",
  forearms: "Antebrazos",
  abs: "Abdominales",
  obliques: "Oblicuos",
  glutes: "Glúteos",
  quads: "Cuádriceps",
  hamstrings: "Isquiotibiales",
  adductors: "Aductores",
  abductors: "Abductores",
  calves: "Gemelos",
  neck: "Cuello",
};

const points = (p: number[]) => p.reduce((s, v, i) => s + (i % 2 ? `,${v}` : `${i ? " " : ""}${v}`), "");

/** One figure: the silhouette quiet, secondary muscles soft, primary ones lit. */
export function BodyFigure({ view, primary, secondary = [], className }: { view: "front" | "back"; primary: Muscle[]; secondary?: Muscle[]; className?: string }) {
  const polygons: BodyPolygon[] = view === "front" ? FRONT : BACK;
  const fill = (m: Muscle | null) => (m && primary.includes(m) ? PRIMARY : m && secondary.includes(m) ? SECONDARY : "color-mix(in oklab, var(--muted-foreground) 26%, transparent)");
  return (
    <svg viewBox={`0 0 ${BODY_SIZE.width} ${BODY_SIZE.height}`} className={className} aria-hidden>
      {polygons.map(([muscle, p], i) => (
        <polygon key={i} points={points(p)} fill={fill(muscle)} />
      ))}
    </svg>
  );
}

/** The figure that shows the first primary muscle (back when it only shows there), small, in a tinted circle. */
export function MuscleBadge({ primary, className }: { primary: Muscle[]; className?: string }) {
  if (primary.length === 0) return null;
  const view = FRONT.some(([m]) => m === primary[0]) ? "front" : "back";
  return (
    <span className={cn("bg-muted grid size-11 shrink-0 place-items-center rounded-full", className)} role="img" aria-label={primary.map((m) => MUSCLE_ES[m]).join(", ")} title={primary.map((m) => MUSCLE_ES[m]).join(", ")}>
      <BodyFigure view={view} primary={primary} className="h-9" />
    </span>
  );
}

/** Front and back with a legend: the exercise panel's muscle map. */
export function MuscleMap({ primary, secondary }: { primary: Muscle[]; secondary: Muscle[] }) {
  return (
    <div>
      <div className="flex justify-center gap-6">
        {(["front", "back"] as const).map((view) => (
          <figure key={view} className="flex flex-col items-center gap-1.5">
            <BodyFigure view={view} primary={primary} secondary={secondary} className="h-52" />
            <figcaption className="text-muted-foreground text-[11px] font-medium">{view === "front" ? "Frente" : "Espalda"}</figcaption>
          </figure>
        ))}
      </div>
      <dl className="mt-4 grid gap-2 text-[13px]">
        {primary.length > 0 && <Legend color={PRIMARY} label="Principal" muscles={primary} />}
        {secondary.length > 0 && <Legend color={SECONDARY} label="Secundario" muscles={secondary} />}
      </dl>
    </div>
  );
}

function Legend({ color, label, muscles }: { color: string; label: string; muscles: Muscle[] }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground flex w-24 shrink-0 items-center gap-1.5">
        <span className="size-2 rounded-full" style={{ background: color }} />
        {label}
      </dt>
      <dd>{muscles.map((m) => MUSCLE_ES[m]).join(", ")}</dd>
    </div>
  );
}

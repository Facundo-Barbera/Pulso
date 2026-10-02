import type { BodyAnalysis, BodyGauge } from "@pulso/contract";
import { BicepsFlexed, ChartNoAxesGantt, CircleAlert, CircleCheck, Droplet, Gauge, Info, Percent, Ruler, Scale, Shell, UserRound, type LucideIcon } from "lucide-react";
import { Card, CardTitle } from "../../../_ui/card";
import { cn } from "../../../_ui/cn";
import { EmptyState } from "../../../_ui/empty-state";
import { BAND_LABEL, kg, METRIC } from "./metrics";

const GAUGE: Record<BodyGauge["metric"], { label: string; icon: LucideIcon; color: string; decimals?: number }> = {
  weight: { label: "Peso", icon: Scale, color: METRIC.weight.color },
  skeletalMuscleMass: { label: "Músculo esquelético", icon: BicepsFlexed, color: METRIC.skeletalMuscleMass.color },
  bodyFatMass: { label: "Masa grasa", icon: Droplet, color: METRIC.bodyFatMass.color },
  bmi: { label: "IMC", icon: Gauge, color: "var(--domain-body)" },
  percentBodyFat: { label: "Grasa corporal", icon: Percent, color: METRIC.percentBodyFat.color },
  visceralFatLevel: { label: "Grasa visceral", icon: Shell, color: "var(--domain-fat)", decimals: 0 },
};

/** Is this band fine? Normal always; more muscle is fine; less fat, weight or BMI is a note, not an alarm. */
type Tone = "good" | "caution" | "neutral";
function tone(g: BodyGauge): Tone {
  if (g.band === "normal") return "good";
  if (g.metric === "skeletalMuscleMass") return g.band === "high" ? "good" : "caution";
  return g.band === "high" ? "caution" : "neutral";
}

const TONE = {
  good: { icon: CircleCheck, className: "text-good bg-good/12" },
  caution: { icon: CircleAlert, className: "text-caution bg-caution/12" },
  neutral: { icon: Info, className: "text-muted-foreground bg-muted" },
};

const unitOf = (g: BodyGauge) => (g.unit === "nivel" ? "" : g.unit);

/** InBody's "Análisis músculo-grasa": weight, muscle and fat against the standard for the height. */
export function MuscleFatCard({ analysis, date, delay }: { analysis: BodyAnalysis; date?: string; delay: number }) {
  return (
    <Card delay={delay}>
      <CardTitle icon={ChartNoAxesGantt} color="var(--domain-protein)" title="Músculo y grasa" />
      {analysis.muscleFat ? (
        <>
          <div className="space-y-5">
            {analysis.muscleFat.gauges.map((g) => (
              <GaugeRow key={g.metric} gauge={g} />
            ))}
          </div>
          <Basis analysis={analysis} date={date} />
        </>
      ) : (
        <EmptyState
          compact
          icon={UserRound}
          color="var(--domain-protein)"
          title="Falta tu altura"
          line={analysis.basis ? "Con un escaneo de InBody (peso, músculo y grasa) verás dónde está cada uno." : "Con tu altura y sexo en el perfil comparo peso, músculo y grasa con lo normal para ti."}
          action={analysis.basis ? { href: "#anadir", label: "Añadir medición" } : { href: "#perfil", label: "Completar perfil" }}
        />
      )}
    </Card>
  );
}

/** InBody's "Análisis de obesidad": BMI and % fat against their ranges, and the visceral level as a dial. */
export function ObesityCard({ gauges, date, delay }: { gauges: BodyGauge[]; date?: string; delay: number }) {
  const bars = gauges.filter((g) => g.metric !== "visceralFatLevel");
  const visceral = gauges.find((g) => g.metric === "visceralFatLevel");
  return (
    <Card delay={delay}>
      <CardTitle icon={Ruler} color="var(--domain-fat)" title="Obesidad" />
      <div className="space-y-5">
        {bars.map((g) => (
          <GaugeRow key={g.metric} gauge={g} />
        ))}
      </div>
      {visceral && <VisceralDial gauge={visceral} className={bars.length ? "border-border mt-5 border-t pt-4" : undefined} />}
      {date && <p className="text-muted-foreground mt-4 text-[12px]">Del escaneo del {date}.</p>}
    </Card>
  );
}

function Basis({ analysis, date }: { analysis: BodyAnalysis; date?: string }) {
  const b = analysis.basis!;
  const sex = b.sex === "male" ? "hombre" : b.sex === "female" ? "mujer" : null;
  return (
    <p className="text-muted-foreground mt-5 text-[12px] leading-relaxed">
      % del estándar para {(b.heightCm / 100).toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m{sex ? ` (${sex})` : ""}: {kg(b.standardWeight)} kg.{b.heightFrom === "scan" && " Altura deducida del IMC del escaneo."}
      {!sex && " Sin sexo en el perfil uso un promedio."}
      {date && ` Del escaneo del ${date}.`}
    </p>
  );
}

function Verdict({ gauge }: { gauge: BodyGauge }) {
  const t = TONE[tone(gauge)];
  return (
    <span className={cn("inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold", t.className)}>
      <t.icon className="size-3.5" strokeWidth={2.4} aria-hidden />
      {BAND_LABEL[gauge.band]}
    </span>
  );
}

/** One InBody bar: the fill up to the value, the normal zone marked, the previous scan as a ghost tick, the sheet's ticks under it. */
function GaugeRow({ gauge: g }: { gauge: BodyGauge }) {
  const meta = GAUGE[g.metric];
  const decimals = meta.decimals ?? 1;
  const unit = unitOf(g);
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  return (
    <div className="@container">
      <div className="flex items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: `color-mix(in oklab, ${meta.color} 16%, transparent)`, color: meta.color }}>
          <meta.icon className="size-3.5" strokeWidth={2.2} aria-hidden />
        </span>
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{meta.label}</p>
        <p className="tabular text-[15px] font-semibold whitespace-nowrap">
          {kg(g.value, decimals)} {unit && <span className="text-muted-foreground text-[11px] font-normal">{unit}</span>}
        </p>
        <Verdict gauge={g} />
      </div>
      <div
        className="relative mt-2.5 h-2.5"
        role="img"
        aria-label={`${meta.label} ${kg(g.value, decimals)} ${unit}: ${BAND_LABEL[g.band]}; normal ${kg(g.normal.low, decimals)}–${kg(g.normal.high, decimals)}${g.previous != null ? `; antes ${kg(g.previous, decimals)}` : ""}`}
      >
        <div className="bg-muted absolute inset-0 rounded-full" />
        <div className="border-foreground/25 absolute inset-y-[-3px] rounded-[3px] border-x" style={{ left: pct(g.at.low), width: pct(g.at.high - g.at.low), background: "color-mix(in oklab, var(--foreground) 7%, transparent)" }} />
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `max(${pct(g.at.value)}, 10px)`, background: meta.color }} />
        {g.at.previous != null && (
          <div className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full" style={{ left: pct(g.at.previous), background: "color-mix(in oklab, var(--foreground) 55%, transparent)", boxShadow: "0 0 0 2px var(--card)" }} title={`Escaneo anterior: ${kg(g.previous!, decimals)} ${unit}`} />
        )}
      </div>
      <div className="text-muted-foreground relative mt-1.5 h-3.5 text-[10px]" aria-hidden>
        {g.ticks.map((t, i) => (
          <span
            key={i}
            className={cn("tabular absolute top-0", i % 2 === 1 && "hidden @sm:inline", i === 0 ? "" : i === g.ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2")}
            style={{ left: pct(i / (g.ticks.length - 1)) }}
          >
            {t}
          </span>
        ))}
      </div>
      <p className="text-muted-foreground mt-1 text-[11px]">
        Normal {kg(g.normal.low, decimals)}–{kg(g.normal.high, decimals)} {unit}
        {g.percent != null && <span className="tabular"> · {g.percent} % del estándar</span>}
        {g.previous != null && (
          <span className="tabular">
            {" "}
            · antes {kg(g.previous, decimals)} {unit}
          </span>
        )}
      </p>
    </div>
  );
}

/** Visceral fat level 1–20 on a half dial: 1–9 is healthy, 10 and up is high. */
function VisceralDial({ gauge: g, className }: { gauge: BodyGauge; className?: string }) {
  const arc = (from: number, to: number) => {
    const point = (t: number) => {
      const angle = Math.PI * (1 - t);
      return `${(60 + 48 * Math.cos(angle)).toFixed(2)} ${(58 - 48 * Math.sin(angle)).toFixed(2)}`;
    };
    return `M${point(from)}A48 48 0 0 1 ${point(to)}`;
  };
  const angle = Math.PI * (1 - g.at.value);
  const x = 60 + 48 * Math.cos(angle);
  const y = 58 - 48 * Math.sin(angle);
  const meta = GAUGE.visceralFatLevel;
  return (
    <div className={cn("flex items-center gap-4", className)}>
      <svg viewBox="0 0 120 66" className="w-32 shrink-0" role="img" aria-label={`Grasa visceral nivel ${kg(g.value, 0)}: ${BAND_LABEL[g.band]}; sano hasta 9`}>
        <path d={arc(0, g.at.high)} fill="none" stroke="var(--state-good)" strokeOpacity="0.35" strokeWidth="10" strokeLinecap="round" />
        <path d={arc(g.at.high + 0.04, 1)} fill="none" stroke="var(--state-caution)" strokeOpacity="0.35" strokeWidth="10" strokeLinecap="round" strokeDasharray="3 3" />
        <circle cx={x} cy={y} r="7" fill={meta.color} stroke="var(--card)" strokeWidth="3" />
        <text x="60" y="56" textAnchor="middle" className="tabular fill-foreground text-[22px] font-semibold">
          {kg(g.value, 0)}
        </text>
      </svg>
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <meta.icon className="size-4 shrink-0" style={{ color: meta.color }} aria-hidden />
          Grasa visceral
        </p>
        <p className="mt-1.5">
          <Verdict gauge={g} />
        </p>
        <p className="text-muted-foreground mt-1 text-[12px] leading-relaxed">
          Nivel de 1 a 20; sano hasta 9.{g.previous != null && ` Antes ${kg(g.previous, 0)}.`}
        </p>
      </div>
    </div>
  );
}

"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { ACCENTS, DEFAULT_APPEARANCE, readAppearance, saveAppearance, type Appearance } from "../../../_ui/appearance";
import { cn } from "../../../_ui/cn";

const THEME_LABELS: [Appearance["theme"], string][] = [["system", "Sistema"], ["dark", "Oscuro"], ["light", "Claro"]];
const DEPTH_LABELS: [Appearance["depth"], string][] = [["flat", "Plana"], ["soft", "Suave"], ["deep", "Profunda"]];
const FONT_LABELS: [Appearance["font"], string][] = [["geist", "Geist"], ["inter", "Inter"], ["system", "Sistema"]];
const ACCENT_LABELS: Record<Appearance["accent"], string> = { rose: "Rosa", indigo: "Índigo", violet: "Violeta", plum: "Ciruela", sky: "Cielo", sea: "Mar", moss: "Musgo", amber: "Ámbar" };

/** Theme, accent, depth, typeface and the Mac window's translucency. Per browser (localStorage), applied live. */
export function AppearancePanel() {
  // Server render uses the defaults; the stored value lands right after mount (same sizes, so no shift).
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  useEffect(() => setAppearance(readAppearance()), []);
  const update = (patch: Partial<Appearance>) => {
    const next = { ...appearance, ...patch };
    setAppearance(next);
    saveAppearance(next);
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Row label="Tema">
        <Segmented options={THEME_LABELS} value={appearance.theme} onChange={(theme) => update({ theme })} />
      </Row>
      <Row label="Acento">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Acento">
          {ACCENTS.map((accent) => (
            <button
              key={accent}
              role="radio"
              aria-checked={appearance.accent === accent}
              aria-label={ACCENT_LABELS[accent]}
              title={ACCENT_LABELS[accent]}
              data-accent={accent}
              onClick={() => update({ accent })}
              className="bg-primary text-primary-foreground focus-visible:ring-ring grid size-9 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              {appearance.accent === accent && <Check className="size-4" strokeWidth={3} />}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Profundidad">
        <Segmented options={DEPTH_LABELS} value={appearance.depth} onChange={(depth) => update({ depth })} />
      </Row>
      <Row label="Tipografía">
        <Segmented options={FONT_LABELS} value={appearance.font} onChange={(font) => update({ font })} />
      </Row>
      <Row label="Ventana translúcida" hint="Sólo en la app de la Mac: deja ver el escritorio a través de la barra lateral.">
        <button
          role="switch"
          aria-checked={appearance.translucent}
          onClick={() => update({ translucent: !appearance.translucent })}
          className={cn("focus-visible:ring-ring relative h-7 w-12 rounded-full outline-none transition-colors focus-visible:ring-2", appearance.translucent ? "bg-primary" : "bg-input/60")}
        >
          <span className={cn("shadow-1 absolute top-0.5 size-6 rounded-full bg-white transition-[left]", appearance.translucent ? "left-[22px]" : "left-0.5")} />
        </button>
      </Row>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-medium">{label}</p>
      {children}
      {hint && <p className="text-muted-foreground mt-2 text-[12px]">{hint}</p>}
    </div>
  );
}

function Segmented<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="bg-muted inline-flex rounded-xl p-1" role="radiogroup">
      {options.map(([option, label]) => (
        <button
          key={option}
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn("focus-visible:ring-ring min-h-9 rounded-lg px-3.5 text-[13px] outline-none transition-colors focus-visible:ring-2", value === option ? "bg-card shadow-1 font-medium" : "text-muted-foreground hover:text-foreground")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

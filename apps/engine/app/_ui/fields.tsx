"use client";

import { cn } from "./cn";

/** Form pieces for the editors in a `Sheet`: one look for inputs, choices and buttons. */

export const inputClass =
  "bg-muted/60 border-border placeholder:text-muted-foreground focus-visible:ring-ring h-11 w-full min-w-0 rounded-xl border px-3 text-[15px] outline-none focus-visible:ring-2 disabled:opacity-60";

const BUTTON = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "bg-muted text-foreground hover:bg-accent",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-muted",
  danger: "text-destructive hover:bg-destructive/10",
};

export function Button({ variant = "secondary", className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "focus-visible:ring-ring inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-medium outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 motion-safe:transition-[background-color,opacity]",
        BUTTON[variant],
        className,
      )}
    />
  );
}

/** A labelled single control. */
export function Field({ label, hint, className, children }: { label: string; hint?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="text-muted-foreground mb-1.5 block text-[12px] font-medium">{label}</span>
      {children}
      {hint && <span className="text-muted-foreground mt-1.5 block text-[12px] leading-relaxed">{hint}</span>}
    </label>
  );
}

/** A labelled group of controls (buttons inside a <label> would all answer its click). */
export function FieldGroup({ label, hint, className, children }: { label: string; hint?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="text-muted-foreground mb-1.5 block text-[12px] font-medium">{label}</legend>
      {children}
      {hint && <p className="text-muted-foreground mt-1.5 text-[12px] leading-relaxed">{hint}</p>}
    </fieldset>
  );
}

/** One choice among a few, as a pill row. */
export function Segmented<T extends string>({ value, options, onChange, label, className }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("bg-muted/70 inline-flex rounded-full p-1", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "focus-visible:ring-ring min-h-9 flex-1 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap outline-none focus-visible:ring-2 motion-safe:transition-colors",
            value === option.value ? "bg-card text-foreground shadow-1" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const WEEKDAYS = [
  { day: 1, short: "L", long: "lunes" },
  { day: 2, short: "M", long: "martes" },
  { day: 3, short: "X", long: "miércoles" },
  { day: 4, short: "J", long: "jueves" },
  { day: 5, short: "V", long: "viernes" },
  { day: 6, short: "S", long: "sábado" },
  { day: 7, short: "D", long: "domingo" },
];

/** ISO weekdays (1 = lunes … 7 = domingo) as seven toggles. */
export function WeekdayPicker({ value, onChange, color = "var(--primary)" }: { value: number[]; onChange: (days: number[]) => void; color?: string }) {
  return (
    <div className="flex gap-1.5">
      {WEEKDAYS.map(({ day, short, long }) => {
        const on = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            aria-label={long}
            onClick={() => onChange(on ? value.filter((d) => d !== day) : [...value, day].sort())}
            className={cn("focus-visible:ring-ring grid size-10 place-items-center rounded-full text-[13px] font-semibold outline-none focus-visible:ring-2 motion-safe:transition-colors", on ? "text-white" : "bg-muted text-muted-foreground hover:text-foreground")}
            style={on ? { background: color } : undefined}
          >
            {short}
          </button>
        );
      })}
    </div>
  );
}

/** A switch with its label on the left. */
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (on: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="focus-visible:ring-ring flex w-full items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">{label}</span>
        {hint && <span className="text-muted-foreground block text-[12px]">{hint}</span>}
      </span>
      <span className={cn("relative h-7 w-12 shrink-0 rounded-full motion-safe:transition-colors", checked ? "bg-success" : "bg-muted-foreground/30")}>
        <span className={cn("bg-background shadow-1 absolute top-0.5 size-6 rounded-full motion-safe:transition-[left]", checked ? "left-[22px]" : "left-0.5")} />
      </span>
    </button>
  );
}

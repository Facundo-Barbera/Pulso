import { cn } from "./cn";

/** One number with its label and unit; `children` is room for a sparkline under it. Rounded, tabular numerals. */
export function StatTile({ label, value, unit, caption, color, className, children }: { label: string; value: React.ReactNode; unit?: string; caption?: React.ReactNode; color?: string; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-muted-foreground flex items-center gap-1.5 text-[12px] font-medium">
        {color && <span className="size-1.5 rounded-full" style={{ background: color }} />}
        {label}
      </p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="tabular text-[26px] leading-none font-semibold tracking-tight">{value}</span>
        {unit && <span className="text-muted-foreground text-[13px]">{unit}</span>}
      </p>
      {caption && <p className="text-muted-foreground mt-1.5 text-[12px]">{caption}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

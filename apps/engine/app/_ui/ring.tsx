/**
 * A progress ring, 0–100. The arc sweeps in once on mount (off for reduced
 * motion); `children` sits in the middle. Server-rendered: no layout shift.
 */
export function Ring({ value, size = 168, stroke = 14, color, track = "var(--muted)", glow = false, children, label }: { value: number | null; size?: number; stroke?: number; color: string; track?: string; glow?: boolean; children?: React.ReactNode; label: string }) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={label}>
      {glow && <div className="absolute inset-[12%] rounded-full opacity-40 blur-2xl" style={{ background: color }} aria-hidden />}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="relative -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} className="ring-track" />
        {fraction > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            className="motion-safe:animate-[pulso-ring_1100ms_cubic-bezier(.2,.7,.2,1)_both]"
            style={{ "--ring-circumference": circumference } as React.CSSProperties}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

"use client";

import { Sparkles } from "lucide-react";
import { cn } from "../../../_ui/cn";

/** The Coach's mark: white sparkles on the brand gradient; breathes while it answers. */
export function CoachAvatar({ size = 28, active = false, className }: { size?: number; active?: boolean; className?: string }) {
  return (
    <span className={cn("shadow-1 grid shrink-0 place-items-center rounded-full text-white", className)} style={{ width: size, height: size, background: "var(--pulso-gradient)" }} aria-hidden>
      <Sparkles className={cn(active && "motion-safe:animate-pulse")} style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2.2} />
    </span>
  );
}

/** Three dots that breathe while the Coach is thinking. */
export function ThinkingDots() {
  return (
    <span className="bg-muted inline-flex h-9 items-center gap-1 rounded-full px-3.5" role="status" aria-label="El Coach está pensando">
      {[0, 160, 320].map((delay) => (
        <span key={delay} className="bg-muted-foreground size-1.5 rounded-full opacity-60 motion-safe:animate-bounce" style={{ animationDelay: `${delay}ms`, animationDuration: "1s" }} />
      ))}
    </span>
  );
}

/** The brand gradient turning slowly around a surface while the Coach answers (iOS: GlowBorder). */
export function Glow({ active, radius, children, className }: { active: boolean; radius: number; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative isolate p-[1.5px]", className)} style={{ borderRadius: radius + 1.5 }}>
      <div className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden transition-opacity duration-500", active ? "opacity-100" : "opacity-0")} style={{ borderRadius: radius + 1.5 }} aria-hidden>
        <div className="absolute top-1/2 left-1/2 aspect-square w-[max(150%,600px)] -translate-x-1/2 -translate-y-1/2 motion-safe:animate-[spin_3.5s_linear_infinite]" style={{ background: "conic-gradient(from 0deg, var(--pulso-coral), var(--pulso-rose), var(--pulso-violet), var(--domain-fat), var(--pulso-coral))" }} />
      </div>
      {children}
    </div>
  );
}

/** Copy that also works over plain http on the tailnet, where `navigator.clipboard` does not exist. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the old way
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  return ok;
}

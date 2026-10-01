import { cn } from "./cn";

/** A placeholder block that shimmers while data loads (still for reduced motion). Size it like what it stands for, so nothing shifts. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("pulso-skeleton rounded-lg", className)} aria-hidden />;
}

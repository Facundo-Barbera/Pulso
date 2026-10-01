import { useId } from "react";

/** The Pulso icon (app/icon.svg) as a rounded mark: the brand gradient and the climbing heartbeat. */
export function PulsoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF7A45" />
          <stop offset="0.5" stopColor="#F5335F" />
          <stop offset="1" stopColor="#8A2BE2" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="232" fill={`url(#${id}g)`} />
      <g fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="72">
        <path d="M190 612H340L405 482L480 722L570 302L650 592L840 402" />
        <path d="M718 402H840V524" />
      </g>
    </svg>
  );
}

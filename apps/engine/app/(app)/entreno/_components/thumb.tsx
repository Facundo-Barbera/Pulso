"use client";

import { Dumbbell } from "lucide-react";
import { useState } from "react";
import { cn } from "../../../_ui/cn";

/**
 * An exercise's demonstration still (or the looping GIF), streamed by the
 * engine. Without media, or when ExerciseDB does not answer, a quiet glyph.
 */
export function Thumb({ src, className, alt = "" }: { src: string | null; className?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={cn("bg-muted grid shrink-0 place-items-center overflow-hidden rounded-xl", className)}>
      {src && !failed ? (
        // GIFs streamed under ExerciseDB's terms: next/image would cache them on disk.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full bg-white object-contain" />
      ) : (
        <Dumbbell className="text-training size-1/3 min-h-4 min-w-4" strokeWidth={1.8} aria-hidden />
      )}
    </span>
  );
}

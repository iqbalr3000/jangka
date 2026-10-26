import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "./use-media-query";

/** Characters to reveal in one frame: a burst drains in ~12 frames, a trickle still types. */
export function revealStep(backlog: number): number {
  return backlog <= 0 ? 0 : Math.min(backlog, Math.max(2, Math.ceil(backlog / 12)));
}

/**
 * Reveals `target` as if typed quickly, however unevenly it streams in. Shows it whole when
 * `animate` is off or the user prefers reduced motion.
 */
export function useSmoothText(target: string, animate: boolean): string {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const smooth = animate && !reduced;
  const [shown, setShown] = useState(smooth ? 0 : target.length);
  const length = useRef(shown);

  useEffect(() => {
    if (!smooth) {
      length.current = target.length;
      setShown(target.length);
      return;
    }
    // A shorter target is a new text, not a continuation.
    if (length.current > target.length) length.current = 0;
    let frame = 0;
    const tick = () => {
      const step = revealStep(target.length - length.current);
      if (step === 0) return;
      length.current += step;
      setShown(length.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, smooth]);

  return target.slice(0, smooth ? shown : target.length);
}

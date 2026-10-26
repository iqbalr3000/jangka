import { useEffect, useState } from "react";

const STILL_THINKING_MS = 8000;

/** Shown in the assistant bubble until the first words of the reply arrive. */
export function ThinkingIndicator({ referenceCount }: { referenceCount: number }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), STILL_THINKING_MS);
    return () => clearTimeout(timer);
  }, []);

  const label = slow
    ? "Still thinking…"
    : referenceCount > 0
      ? `Reading ${referenceCount} related ${referenceCount === 1 ? "section" : "sections"}…`
      : "Thinking…";

  return (
    <span role="status" className="flex items-center gap-2.5">
      <span className="flex items-center gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="thinking-dot size-1.5 rounded-full bg-primary"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </span>
      <span className="thinking-label text-muted-foreground">{label}</span>
    </span>
  );
}

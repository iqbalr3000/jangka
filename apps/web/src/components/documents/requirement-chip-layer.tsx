import { Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { type Chip, type ChipIndex, focusOf } from "@/lib/requirement-chips";

type Hovered = { chip: Chip; element: HTMLElement; left: number; top: number };

const priorityLabels: Record<string, string> = { must: "Must", should: "Should", could: "Could" };

/**
 * One tooltip and click handler for every chip on the page (event delegation), so the section
 * editors only render decorations.
 */
export function RequirementChipLayer({
  chips,
  onOpen,
}: {
  chips: ChipIndex;
  /** Opens the Trace panel on this own requirement. */
  onOpen: (code: string) => void;
}) {
  const [hovered, setHovered] = useState<Hovered | null>(null);

  useEffect(() => {
    const chipAt = (target: EventTarget | null) => {
      const element = target instanceof Element ? target.closest<HTMLElement>("[data-req]") : null;
      const chip = element?.dataset.req ? chips.get(element.dataset.req) : undefined;
      return element && chip ? { element, chip } : null;
    };
    const place = (chip: Chip, element: HTMLElement): Hovered => {
      const rect = element.getBoundingClientRect();
      return { chip, element, left: rect.left, top: rect.bottom + 6 };
    };
    const over = (event: MouseEvent) => {
      const found = chipAt(event.target);
      setHovered(found ? place(found.chip, found.element) : null);
    };
    const click = (event: MouseEvent) => {
      const found = chipAt(event.target);
      if (!found) return;
      setHovered(null);
      onOpen(focusOf(found.chip));
    };
    // Scrolling moves the chip: the tooltip follows it, and goes once the chip is gone.
    const follow = () =>
      setHovered((current) =>
        current?.element.isConnected ? place(current.chip, current.element) : null,
      );
    document.addEventListener("mouseover", over);
    document.addEventListener("click", click);
    window.addEventListener("scroll", follow, true);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("click", click);
      window.removeEventListener("scroll", follow, true);
    };
  }, [chips, onOpen]);

  if (!hovered) return null;
  const { chip } = hovered;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 max-w-80 rounded-md border border-border bg-card px-3 py-2 text-[13px] shadow-float"
      style={{ left: Math.min(hovered.left, window.innerWidth - 336), top: hovered.top }}
    >
      <div className="mb-0.5 font-mono text-[11px] text-muted-foreground">
        {chip.kind === "own" ? chip.code : `↑ ${chip.code}`}
        {chip.kind === "own" && chip.priority && ` · ${priorityLabels[chip.priority]}`}
        {chip.kind === "own" && chip.needsReview && " · Needs review"}
      </div>
      {chip.kind === "own" && (
        <>
          <p>{chip.text}</p>
          {chip.upstream.length > 0 && (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              ↑ {chip.upstream.join(", ")}
            </p>
          )}
        </>
      )}
      {chip.kind === "upstream" && (
        <>
          <p>{chip.text}</p>
          {chip.source && <p className="mt-1 text-xs text-muted-foreground">{chip.source}</p>}
        </>
      )}
      {chip.kind === "restricted" && (
        <p className="flex items-center gap-1 text-muted-foreground">
          <Lock className="size-3" aria-hidden /> Restricted document
        </p>
      )}
      {chip.kind === "missing" && (
        <p className="text-muted-foreground">Not found in the source document</p>
      )}
    </div>
  );
}

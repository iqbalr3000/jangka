import type { Section } from "@jangka/shared/document";
import { completenessSummary, sectionAnchor } from "@/lib/documents";
import { cn } from "@/lib/utils";
import { SectionStatusIcon } from "./section-status-icon";

// 1024–1279 px: status icons only, titles as tooltips.
const wide = "lg:hidden xl:inline";

/**
 * Left rail: status + title per section; ◇ marks sections that expect a diagram.
 * `labels`: transient status per section key, e.g. "Queued" / "Drafting".
 */
export function SectionOutline({
  sections,
  labels = {},
  className,
  onSelect,
}: {
  sections: Section[];
  labels?: Record<string, string>;
  className?: string;
  /** Shows and scrolls to the section (on small screens the document pane may be hidden). */
  onSelect: (key: string) => void;
}) {
  return (
    <nav
      aria-label="Outline"
      className={cn(
        "shrink-0 flex-col gap-3 overflow-auto border-border px-3 py-5 lg:w-14 lg:border-r lg:px-2 xl:w-[220px] xl:px-3",
        className,
      )}
    >
      <span
        className={cn(
          wide,
          "px-2 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground",
        )}
      >
        OUTLINE
      </span>
      <ol className="flex flex-col gap-px text-[13px]">
        {sections.map((section) => (
          <li key={section.key}>
            <a
              href={`#${sectionAnchor(section.key)}`}
              title={section.title}
              onClick={(event) => {
                event.preventDefault();
                onSelect(section.key);
              }}
              className="flex items-center gap-2 rounded-sm px-2 py-1 hover:bg-secondary lg:justify-center xl:justify-start"
            >
              <SectionStatusIcon completeness={section.completeness} />
              <span className={cn(wide, "min-w-0 flex-1 truncate")}>{section.title}</span>
              {labels[section.key] && (
                <span className={cn(wide, "text-[11px] text-primary")}>{labels[section.key]}</span>
              )}
              {section.expectsDiagram && (
                <span
                  className={cn(wide, "text-muted-foreground")}
                  title="Expects a diagram"
                  aria-hidden
                >
                  ◇
                </span>
              )}
            </a>
          </li>
        ))}
      </ol>
      <span className={cn(wide, "px-2 text-xs text-muted-foreground")}>
        {completenessSummary(sections)}
      </span>
    </nav>
  );
}

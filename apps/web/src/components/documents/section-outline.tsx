import type { Section } from "@jangka/shared/document";
import { completenessSummary, sectionAnchor } from "@/lib/documents";
import { SectionStatusIcon } from "./section-status-icon";

/**
 * Left rail: status + title per section; ◇ marks sections that expect a diagram.
 * `labels`: transient status per section key, e.g. "Queued" / "Drafting".
 */
export function SectionOutline({
  sections,
  labels = {},
}: {
  sections: Section[];
  labels?: Record<string, string>;
}) {
  return (
    <nav
      aria-label="Outline"
      className="hidden w-[220px] shrink-0 flex-col gap-3 overflow-auto border-r border-border px-3 py-5 lg:flex"
    >
      <span className="px-2 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground">
        OUTLINE
      </span>
      <ol className="flex flex-col gap-px text-[13px]">
        {sections.map((section) => (
          <li key={section.key}>
            <a
              href={`#${sectionAnchor(section.key)}`}
              onClick={(event) => {
                event.preventDefault();
                document
                  .getElementById(sectionAnchor(section.key))
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="flex items-center gap-2 rounded-sm px-2 py-1 hover:bg-secondary"
            >
              <SectionStatusIcon completeness={section.completeness} />
              <span className="min-w-0 flex-1 truncate">{section.title}</span>
              {labels[section.key] && (
                <span className="text-[11px] text-primary">{labels[section.key]}</span>
              )}
              {section.expectsDiagram && (
                <span className="text-muted-foreground" title="Expects a diagram" aria-hidden>
                  ◇
                </span>
              )}
            </a>
          </li>
        ))}
      </ol>
      <span className="px-2 text-xs text-muted-foreground">{completenessSummary(sections)}</span>
    </nav>
  );
}

import type { DraftSection } from "@jangka/shared/templates";
import {
  REQUIREMENT_KINDS_BY_TYPE,
  REQUIREMENT_PREFIX,
  type RequirementKind,
} from "@jangka/templates";
import { ArrowDown, ArrowUp, ChevronRight, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const DIAGRAM_LABELS = {
  flowchart: "Flowchart",
  sequence: "Sequence",
  erd: "ERD",
  state: "State",
} as const;
const DIAGRAMS = ["flowchart", "sequence", "erd", "state"] as const;
const KIND_LABELS: Record<RequirementKind, string> = {
  business: "Business (BR-)",
  functional: "Functional (FR-)",
  non_functional: "Non-functional (NFR-)",
  technical: "Technical (TR-)",
};

type TemplateSectionCardProps = {
  index: number;
  count: number;
  docType: "brd" | "prd" | "tsd";
  section: DraftSection;
  readOnly: boolean;
  expanded: boolean;
  /** Just added: focus and scroll to the title. */
  autoFocus: boolean;
  /** Validation messages by field (`title`, `requirementKind`, …). */
  errors: Record<string, string>;
  onToggle: () => void;
  onChange: (section: DraftSection) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
};

const fieldClass = "rounded-sm border border-input bg-card px-2 text-sm disabled:opacity-70";
const iconButton =
  "rounded-sm p-1.5 text-muted-foreground hover:bg-secondary disabled:pointer-events-none disabled:opacity-30";

/** One section of a template draft: a one-line summary that expands into its fields. */
export function TemplateSectionCard({
  index,
  count,
  docType,
  section,
  readOnly,
  expanded,
  autoFocus,
  errors,
  onToggle,
  onChange,
  onMove,
  onRemove,
}: TemplateSectionCardProps) {
  const id = `section-${index}`;
  const set = <K extends keyof DraftSection>(key: K, value: DraftSection[K]) =>
    onChange({ ...section, [key]: value });
  const hasErrors = Object.keys(errors).length > 0;
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus || !titleRef.current) return;
    titleRef.current.focus();
    titleRef.current.select();
    titleRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [autoFocus]);

  return (
    <fieldset
      aria-label={section.title || `Section ${index + 1}`}
      className={cn(
        "rounded-md border bg-card text-sm",
        hasErrors ? "border-destructive" : "border-border",
      )}
    >
      <div className="flex items-center gap-2 py-1.5 pr-2 pl-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`${id}-fields`}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-secondary"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
          <span className="w-5 shrink-0 font-mono text-[11px] text-muted-foreground">
            {index + 1}
          </span>
          <span className={cn("truncate font-medium", !section.title && "text-muted-foreground")}>
            {section.title || "Untitled section"}
          </span>
          {hasErrors && (
            <span className="shrink-0 text-xs text-destructive">
              {Object.keys(errors).length === 1
                ? "1 issue"
                : `${Object.keys(errors).length} issues`}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {section.required && <Chip>Required</Chip>}
            {section.expectsDiagram && <Chip>{DIAGRAM_LABELS[section.expectsDiagram]}</Chip>}
            {section.requirementKind && (
              <Chip>{`${REQUIREMENT_PREFIX[section.requirementKind]}-`}</Chip>
            )}
            {section.key && (
              <span className="font-mono text-[11px] text-muted-foreground" title="Stable key">
                {section.key}
              </span>
            )}
          </span>
        </button>
        {!readOnly && (
          <span className="flex shrink-0">
            <button
              type="button"
              aria-label="Move up"
              disabled={index === 0}
              onClick={() => onMove(-1)}
              className={iconButton}
            >
              <ArrowUp className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Move down"
              disabled={index === count - 1}
              onClick={() => onMove(1)}
              className={iconButton}
            >
              <ArrowDown className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Remove section"
              onClick={onRemove}
              className={cn(iconButton, "hover:text-destructive")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </span>
        )}
      </div>

      {expanded && (
        <div id={`${id}-fields`} className="flex flex-col gap-3 border-t border-border p-4">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-title`} className="text-xs text-muted-foreground">
              Title
            </label>
            <Input
              ref={titleRef}
              id={`${id}-title`}
              aria-label="Section title"
              value={section.title}
              disabled={readOnly}
              onChange={(event) => set("title", event.target.value)}
              className="h-9 bg-card font-medium"
            />
          </div>
          {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                className="accent-primary"
                checked={section.required}
                disabled={readOnly}
                onChange={(event) => set("required", event.target.checked)}
              />
              Required
            </label>
            <label className="flex items-center gap-1.5">
              Diagram
              <select
                value={section.expectsDiagram ?? ""}
                disabled={readOnly}
                onChange={(event) => {
                  const value = DIAGRAMS.find((d) => d === event.target.value);
                  set("expectsDiagram", value);
                }}
                className={cn(fieldClass, "h-8")}
              >
                <option value="">None</option>
                {DIAGRAMS.map((diagram) => (
                  <option key={diagram} value={diagram}>
                    {DIAGRAM_LABELS[diagram]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              Requirements
              <select
                aria-label="Requirement kind"
                value={section.requirementKind ?? ""}
                disabled={readOnly}
                onChange={(event) => {
                  const allowed: readonly RequirementKind[] = REQUIREMENT_KINDS_BY_TYPE[docType];
                  set(
                    "requirementKind",
                    allowed.find((kind) => kind === event.target.value),
                  );
                }}
                className={cn(fieldClass, "h-8")}
              >
                <option value="">None</option>
                {REQUIREMENT_KINDS_BY_TYPE[docType].map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {section.requirementKind && (
            <p className="text-xs text-muted-foreground">
              Drafted as an ID | Requirement | Priority table so requirements are tracked, whatever
              the guidance says.
            </p>
          )}
          {errors.requirementKind && (
            <p className="text-xs text-destructive">{errors.requirementKind}</p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Guidance for the assistant</span>
            <textarea
              aria-label="Guidance"
              rows={3}
              placeholder="What this section must contain, its format, and what to leave out."
              value={section.guidance}
              disabled={readOnly}
              onChange={(event) => set("guidance", event.target.value)}
              className={cn(fieldClass, "py-1.5")}
            />
          </label>
          {errors.guidance && <p className="text-xs text-destructive">{errors.guidance}</p>}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Interview questions (one per line)
            </span>
            <textarea
              aria-label="Interview questions"
              rows={2}
              placeholder="What should the assistant ask before drafting this section?"
              value={section.interviewHints.join("\n")}
              disabled={readOnly}
              onChange={(event) => set("interviewHints", event.target.value.split("\n"))}
              className={cn(fieldClass, "py-1.5")}
            />
          </label>
        </div>
      )}
    </fieldset>
  );
}

function Chip({ children }: { children: string }) {
  return (
    <span className="rounded-sm border border-border px-1.5 font-mono text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}

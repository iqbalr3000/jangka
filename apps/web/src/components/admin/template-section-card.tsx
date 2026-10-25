import type { DraftSection } from "@jangka/shared/templates";
import { REQUIREMENT_KINDS_BY_TYPE, type RequirementKind } from "@jangka/templates";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
  /** Validation messages by field (`title`, `requirementKind`, …). */
  errors: Record<string, string>;
  onChange: (section: DraftSection) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
};

const fieldClass = "rounded-sm border border-input bg-card px-2 text-sm disabled:opacity-70";

/** One section of a template draft: title, flags, guidance and interview hints. */
export function TemplateSectionCard({
  index,
  count,
  docType,
  section,
  readOnly,
  errors,
  onChange,
  onMove,
  onRemove,
}: TemplateSectionCardProps) {
  const id = `section-${index}`;
  const set = <K extends keyof DraftSection>(key: K, value: DraftSection[K]) =>
    onChange({ ...section, [key]: value });
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <fieldset
      aria-label={section.title || `Section ${index + 1}`}
      className={cn(
        "flex flex-col gap-3 rounded-md border bg-card p-4 text-sm",
        hasErrors ? "border-destructive" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{index + 1}</span>
        <Input
          id={`${id}-title`}
          aria-label="Section title"
          value={section.title}
          disabled={readOnly}
          onChange={(event) => set("title", event.target.value)}
          className="h-9 flex-1 bg-card font-medium"
        />
        {section.key && (
          <span className="font-mono text-[11px] text-muted-foreground" title="Stable key">
            {section.key}
          </span>
        )}
        {!readOnly && (
          <span className="flex">
            <button
              type="button"
              aria-label="Move up"
              disabled={index === 0}
              onClick={() => onMove(-1)}
              className="rounded-sm p-1.5 text-muted-foreground hover:bg-secondary disabled:opacity-30"
            >
              <ArrowUp className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Move down"
              disabled={index === count - 1}
              onClick={() => onMove(1)}
              className="rounded-sm p-1.5 text-muted-foreground hover:bg-secondary disabled:opacity-30"
            >
              <ArrowDown className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Remove section"
              disabled={count === 1}
              onClick={onRemove}
              className="rounded-sm p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-30"
            >
              <Trash2 className="size-3.5" />
            </button>
          </span>
        )}
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
                {diagram}
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
          Drafted as an ID | Requirement | Priority table so requirements are tracked, whatever the
          guidance says.
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
          value={section.guidance}
          disabled={readOnly}
          onChange={(event) => set("guidance", event.target.value)}
          className={cn(fieldClass, "py-1.5")}
        />
      </label>
      {errors.guidance && <p className="text-xs text-destructive">{errors.guidance}</p>}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Interview questions (one per line)</span>
        <textarea
          aria-label="Interview questions"
          rows={2}
          value={section.interviewHints.join("\n")}
          disabled={readOnly}
          onChange={(event) => set("interviewHints", event.target.value.split("\n"))}
          className={cn(fieldClass, "py-1.5")}
        />
      </label>
    </fieldset>
  );
}

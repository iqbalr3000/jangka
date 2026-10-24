import type { ModelInfo } from "@jangka/shared/llm";
import { Check } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ModelPickerProps = {
  id: string;
  models: ModelInfo[];
  value: string | null;
  onChange: (modelId: string) => void;
};

function contextLabel(tokens: number): string {
  return tokens >= 1_000_000 ? `${tokens / 1_000_000}M` : `${Math.round(tokens / 1000)}k`;
}

/** Searchable list: OpenRouter alone returns hundreds of models. */
export function ModelPicker({ id, models, value, onChange }: ModelPickerProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? models.filter(
        (m) => m.id.toLowerCase().includes(needle) || m.label.toLowerCase().includes(needle),
      )
    : models;

  return (
    <div className="flex flex-col gap-2">
      <Input
        id={id}
        placeholder={`Search ${models.length} models…`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="h-[34px] bg-card text-sm"
      />
      <div
        role="listbox"
        aria-label="Models"
        className="max-h-56 overflow-auto rounded-sm border border-border bg-card py-1 text-[13px]"
      >
        {shown.length === 0 && (
          <p className="px-3 py-2 text-muted-foreground">No matching model.</p>
        )}
        {shown.map((model) => {
          const selected = model.id === value;
          return (
            <button
              key={model.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onChange(model.id)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-secondary",
                selected && "bg-secondary font-medium text-primary",
              )}
            >
              <Check className={cn("size-3.5 shrink-0", !selected && "invisible")} aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {model.label}
                {model.label !== model.id && (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{model.id}</span>
                )}
              </span>
              {model.contextWindow !== undefined && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {contextLabel(model.contextWindow)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

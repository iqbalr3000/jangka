import type { Level } from "@jangka/shared/access";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { levelLabels } from "@/lib/collections";
import type { CellState } from "@/lib/permission-matrix";
import { cn } from "@/lib/utils";

const options: { level: Level; hint: string }[] = [
  { level: "edit", hint: "Create, edit and export documents" },
  { level: "view", hint: "Read and export only" },
  { level: "none", hint: "Hidden, including titles" },
];

const shortLabel: Record<Level, string> = { edit: "Edit", view: "View", none: "– No access" };

type PermissionCellProps = {
  state: CellState;
  label: string;
  /** Name of the collection the inherited value comes from. */
  inheritedFrom: string;
  isRoot: boolean;
  onChange: (level: Level | null) => void;
};

export function PermissionCell({
  state,
  label,
  inheritedFrom,
  isRoot,
  onChange,
}: PermissionCellProps) {
  const inheritedHint = isRoot
    ? "No access (default)"
    : `${levelLabels[state.inherited]}, from ${inheritedFrom}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className={cn(
          "flex h-7 w-full items-center justify-between gap-1 rounded-sm px-2 text-left text-[13px] hover:bg-secondary",
          state.explicit === null && "text-muted-foreground",
          state.staged && "bg-primary/10 font-medium text-primary hover:bg-primary/15",
        )}
      >
        <span className="truncate">
          {state.explicit === null
            ? `↳ ${shortLabel[state.effective]}`
            : shortLabel[state.explicit]}
        </span>
        <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 text-[13px]">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.level}
            onSelect={() => onChange(option.level)}
            className="items-start"
          >
            <Check
              className={cn("mt-0.5 size-3.5", state.explicit !== option.level && "invisible")}
              aria-hidden
            />
            <span className="flex flex-col">
              <span>{levelLabels[option.level]}</span>
              <span className="text-xs text-muted-foreground">{option.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onChange(null)} className="items-start">
          <Check
            className={cn("mt-0.5 size-3.5", state.explicit !== null && "invisible")}
            aria-hidden
          />
          <span className="flex flex-col">
            <span>{isRoot ? "No grant" : "Inherit"}</span>
            <span className="text-xs text-muted-foreground">{inheritedHint}</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

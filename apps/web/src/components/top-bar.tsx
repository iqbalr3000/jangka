import { modKeyLabel } from "@/lib/keyboard";
import type { ShellUser } from "./shell-types";
import { UserMenu } from "./user-menu";
import { Wordmark } from "./wordmark";

export function TopBar({ user }: { user?: ShellUser }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-card px-4">
      <Wordmark className="w-52 shrink-0" />
      <div className="flex flex-1 justify-center">
        {/* Command palette arrives with documents; shown so the layout matches the design. */}
        <button
          type="button"
          disabled
          className="flex h-8 w-full max-w-[480px] items-center gap-2 rounded-sm border border-border bg-secondary px-2.5 text-[13px] text-muted-foreground disabled:cursor-default"
        >
          <kbd className="rounded-[3px] border border-border bg-card px-[5px] py-px font-mono text-[11px] font-medium">
            {modKeyLabel}K
          </kbd>
          Search documents…
        </button>
      </div>
      <button
        type="button"
        disabled
        className="h-8 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
      >
        + New
      </button>
      <UserMenu user={user} />
    </header>
  );
}

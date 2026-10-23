import { Link } from "@tanstack/react-router";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { modKeyLabel } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import type { ShellOrg } from "./shell-types";

type AppSidebarProps = {
  org?: ShellOrg;
  collapsed: boolean;
  onToggle: () => void;
};

const navItemClass =
  "flex items-center gap-2.5 rounded-sm px-2.5 py-[7px] hover:bg-surface-hover data-[status=active]:bg-card data-[status=active]:font-medium data-[status=active]:text-primary data-[status=active]:shadow-[inset_2px_0_0_var(--primary),0_0_0_1px_var(--border)]";

export function AppSidebar({ org, collapsed, onToggle }: AppSidebarProps) {
  return (
    <nav
      aria-label="Main"
      className={cn(
        "hidden shrink-0 flex-col border-r border-border bg-secondary text-[13px] md:flex",
        collapsed ? "w-14" : "w-60",
      )}
    >
      {org && (
        <div className="mx-2 mt-3 mb-1 flex items-center gap-2.5 p-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-foreground text-[13px] font-semibold text-background">
            {org.name[0]?.toUpperCase()}
          </span>
          {!collapsed && (
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate font-semibold">{org.name}</span>
              <span className="truncate text-[11px] text-muted-foreground">{org.host}</span>
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-px px-2 pt-2">
        <Link to="/" className={navItemClass} title={collapsed ? "Home" : undefined}>
          <span
            className="size-[11px] shrink-0 rounded-[2px] border-[1.5px] border-current opacity-70"
            aria-hidden
          />
          {!collapsed && "Home"}
        </Link>
      </div>

      {!collapsed && (
        <>
          <div className="flex items-center justify-between px-[18px] pt-5 pb-2">
            <span className="font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground">
              COLLECTIONS
            </span>
          </div>
          {/* Personal + collection tree arrive with feature `access`. */}
          <p className="px-[18px] text-xs text-muted-foreground">No collections yet.</p>
        </>
      )}

      <div className="flex-1" />

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex w-full items-center justify-between rounded-sm px-2.5 pt-1 pb-1.5 text-xs text-muted-foreground hover:bg-surface-hover"
        >
          {collapsed ? (
            <ChevronsRight className="size-3.5" aria-hidden />
          ) : (
            <>
              <span className="flex items-center gap-1">
                <ChevronsLeft className="size-3.5" aria-hidden />
                Collapse
              </span>
              <kbd className="font-mono text-[11px] text-status-empty">{modKeyLabel}B</kbd>
            </>
          )}
        </button>
      </div>
    </nav>
  );
}

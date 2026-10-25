import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  ArrowLeft,
  ChevronsLeft,
  ChevronsRight,
  House,
  type LucideIcon,
  Plus,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { adminLinks } from "@/lib/admin-links";
import { collectionTreeQuery, ROOT_NAME } from "@/lib/collections";
import { modKeyLabel } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { CollectionTree } from "./collection-tree";
import {
  CollectionNameDialog,
  type CollectionNameTarget,
} from "./collections/collection-name-dialog";
import type { ShellOrg } from "./shell-types";

export type ShellSection = "documents" | "admin";

type AppSidebarProps = {
  org?: ShellOrg;
  section: ShellSection;
  collapsed: boolean;
  onToggle: () => void;
};

const navItemClass =
  "group flex items-center gap-2.5 rounded-sm px-2.5 py-[7px] hover:bg-surface-hover data-[status=active]:bg-card data-[status=active]:font-medium data-[status=active]:text-primary data-[status=active]:shadow-[inset_2px_0_0_var(--primary),0_0_0_1px_var(--border)]";

const sectionLabelClass =
  "font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground";

/** Muted at rest; takes the link's colour (primary) when active or hovered. */
function NavIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <Icon
      className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground group-data-[status=active]:text-primary"
      strokeWidth={1.75}
      aria-hidden
    />
  );
}

function DocumentsNav({ collapsed }: { collapsed: boolean }) {
  const tree = useQuery(collectionTreeQuery);
  const [creating, setCreating] = useState<CollectionNameTarget | null>(null);

  return (
    <>
      <div className="flex flex-col gap-px px-2 pt-2">
        <Link
          to="/"
          activeOptions={{ exact: true }}
          className={navItemClass}
          title={collapsed ? "Home" : undefined}
        >
          <NavIcon icon={House} />
          {!collapsed && "Home"}
        </Link>
        <Link to="/personal" className={navItemClass} title={collapsed ? "Personal" : undefined}>
          <NavIcon icon={UserRound} />
          {!collapsed && "Personal"}
        </Link>
      </div>
      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <div className="flex items-center justify-between px-[18px] pt-5 pb-2">
            <span className={sectionLabelClass}>COLLECTIONS</span>
            {tree.data?.rootLevel === "edit" && (
              <button
                type="button"
                aria-label="New collection"
                onClick={() =>
                  setCreating({ kind: "create", parentId: null, parentName: ROOT_NAME })
                }
                className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-hover"
              >
                <Plus className="size-3.5" />
              </button>
            )}
          </div>
          {tree.data && <CollectionTree items={tree.data.items} />}
          <div className="px-2 pt-3">
            <Link to="/archived" className={cn(navItemClass, "text-xs text-muted-foreground")}>
              <NavIcon icon={Archive} />
              Archived
            </Link>
          </div>
          <CollectionNameDialog target={creating} onClose={() => setCreating(null)} />
        </div>
      )}
    </>
  );
}

function AdminNav({ collapsed }: { collapsed: boolean }) {
  if (collapsed) return null;
  return (
    <>
      <div className="px-2 pt-2">
        <Link to="/" className={cn(navItemClass, "text-muted-foreground")}>
          <NavIcon icon={ArrowLeft} />
          Back to documents
        </Link>
      </div>
      <div className={cn(sectionLabelClass, "px-[18px] pt-5 pb-2")}>ADMIN</div>
      <div className="flex flex-col gap-px px-2">
        {adminLinks.map((link) => (
          <Link key={link.to} to={link.to} className={navItemClass}>
            <NavIcon icon={link.icon} />
            {link.label}
          </Link>
        ))}
      </div>
    </>
  );
}

export function AppSidebar({ org, section, collapsed, onToggle }: AppSidebarProps) {
  return (
    <nav
      aria-label={section === "admin" ? "Admin" : "Main"}
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

      {section === "admin" ? (
        <>
          <AdminNav collapsed={collapsed} />
          <div className="flex-1" />
        </>
      ) : (
        <>
          <DocumentsNav collapsed={collapsed} />
          {collapsed && <div className="flex-1" />}
        </>
      )}

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

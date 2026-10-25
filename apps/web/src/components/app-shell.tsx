import { type ReactNode, useCallback, useEffect, useState } from "react";
import { isEditableTarget } from "@/lib/keyboard";
import { usePersistentState } from "@/lib/persistent-state";
import { useMediaQuery } from "@/lib/use-media-query";
import { AppSidebar, type ShellSection } from "./app-sidebar";
import { ConnectionBanner } from "./connection-banner";
import type { ShellOrg, ShellUser } from "./shell-types";
import { TopBar } from "./top-bar";

const sidebarStates = ["expanded", "collapsed"] as const;

type AppShellProps = {
  user?: ShellUser;
  org?: ShellOrg;
  section?: ShellSection;
  children: ReactNode;
};

export function AppShell({ user, org, section = "documents", children }: AppShellProps) {
  const [sidebar, setSidebar] = usePersistentState("jangka.sidebar", sidebarStates, "expanded");
  // Below 1024 px the sidebar starts collapsed without touching the saved preference.
  const narrow = useMediaQuery("(max-width: 1023px)");
  const [narrowExpanded, setNarrowExpanded] = useState(false);
  const collapsed = narrow ? !narrowExpanded : sidebar === "collapsed";
  const toggle = useCallback(() => {
    if (narrow) setNarrowExpanded(collapsed);
    else setSidebar(collapsed ? "expanded" : "collapsed");
  }, [narrow, collapsed, setSidebar]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key !== "b" ||
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <TopBar user={user} />
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1">
        <AppSidebar org={org} section={section} collapsed={collapsed} onToggle={toggle} />
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

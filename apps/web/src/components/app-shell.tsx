import { type ReactNode, useEffect } from "react";
import { isEditableTarget } from "@/lib/keyboard";
import { usePersistentState } from "@/lib/persistent-state";
import { AppSidebar, type ShellSection } from "./app-sidebar";
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
  const collapsed = sidebar === "collapsed";

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
      setSidebar(collapsed ? "expanded" : "collapsed");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [collapsed, setSidebar]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <TopBar user={user} />
      <div className="flex min-h-0 flex-1">
        <AppSidebar
          org={org}
          section={section}
          collapsed={collapsed}
          onToggle={() => setSidebar(collapsed ? "expanded" : "collapsed")}
        />
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

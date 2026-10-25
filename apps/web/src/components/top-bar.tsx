import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { modKeyLabel } from "@/lib/keyboard";
import { CommandPalette } from "./command-palette";
import { NewDocumentDialog } from "./documents/new-document-dialog";
import type { ShellUser } from "./shell-types";
import { UserMenu } from "./user-menu";
import { Wordmark } from "./wordmark";

export function TopBar({ user }: { user?: ShellUser }) {
  const [creating, setCreating] = useState(false);
  const [searching, setSearching] = useState(false);

  // ⌘K / Ctrl K opens the command palette anywhere in the app (DESIGN §9).
  useEffect(() => {
    if (!user) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearching(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [user]);
  // New documents default to the collection being viewed.
  const currentCollectionId = useRouterState({
    select: (s) => /^\/c\/([^/]+)/.exec(s.location.pathname)?.[1] ?? null,
  });

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-card px-4">
      <Wordmark className="w-52 shrink-0" />
      <div className="flex flex-1 justify-center">
        <button
          type="button"
          disabled={!user}
          onClick={() => setSearching(true)}
          className="flex h-8 w-full max-w-[480px] items-center gap-2 rounded-sm border border-border bg-secondary px-2.5 text-[13px] text-muted-foreground hover:bg-surface-hover disabled:cursor-default"
        >
          <kbd className="rounded-[3px] border border-border bg-card px-[5px] py-px font-mono text-[11px] font-medium">
            {modKeyLabel}K
          </kbd>
          Search documents…
        </button>
      </div>
      <button
        type="button"
        disabled={!user}
        onClick={() => setCreating(true)}
        className="h-8 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        + New
      </button>
      {user && (
        <CommandPalette
          open={searching}
          onOpenChange={setSearching}
          userId={user.id}
          isAdmin={user.isAdmin}
          onNewDocument={() => setCreating(true)}
        />
      )}
      {user && (
        <NewDocumentDialog
          open={creating}
          onOpenChange={setCreating}
          userId={user.id}
          defaultCollectionId={currentCollectionId}
        />
      )}
      <UserMenu user={user} />
    </header>
  );
}

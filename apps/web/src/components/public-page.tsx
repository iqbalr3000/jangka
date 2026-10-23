import type { ReactNode } from "react";

/** Centered layout on the blueprint grid for setup, login, and invite pages. */
export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <div className="blueprint-grid flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-4 py-12 text-foreground">
      {children}
    </div>
  );
}

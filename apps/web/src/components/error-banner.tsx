import type { ReactNode } from "react";

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-sm bg-diff-del px-3 py-2.5 text-[13px] leading-snug text-destructive"
    >
      {children}
    </div>
  );
}

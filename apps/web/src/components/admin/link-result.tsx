import { CopyButton } from "@/components/copy-button";
import { formatDateTime } from "@/lib/format";

/** A one-time link: the server never shows it again, so make copying the obvious next step. */
export function LinkResult({
  url,
  expiresAt,
  email,
}: {
  url: string;
  expiresAt: string;
  email: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-sm border border-border bg-secondary px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={url}>
          {url}
        </span>
        <CopyButton value={url} />
      </div>
      <p className="text-[13px] text-muted-foreground">
        Send it to {email} yourself. It works once, expires {formatDateTime(expiresAt)}, and won't
        be shown again.
      </p>
    </div>
  );
}

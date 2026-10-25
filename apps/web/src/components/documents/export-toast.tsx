import type { ExportJob } from "@jangka/shared/export";
import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { downloadUrl, exportQuery, formatLabels } from "@/lib/exports";
import { errorMessage } from "@/lib/form-errors";

type ExportToastProps = {
  job: ExportJob;
  onRetry: () => void;
  onDismiss: () => void;
};

/** Progress of one export: "Preparing PDF…" → "Ready · Download (expires in 24h)". */
export function ExportToast({ job, onRetry, onDismiss }: ExportToastProps) {
  const status = useQuery({ ...exportQuery(job.id), initialData: job });
  const current = status.data;
  const label = formatLabels[current.format];

  let body: ReactNode;
  if (status.error) {
    body = <span className="text-destructive">{errorMessage(status.error)}</span>;
  } else if (current.status === "done") {
    body = (
      <>
        <span>Ready ·</span>
        <a
          href={downloadUrl(current.id)}
          download={current.fileName ?? undefined}
          className="font-medium text-primary hover:underline"
        >
          Download
        </a>
        <span className="text-muted-foreground">(expires in 24h)</span>
      </>
    );
  } else if (current.status === "failed") {
    body = (
      <>
        <span className="text-destructive">Export failed</span>
        <Button size="xs" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
        <span>Preparing {label}…</span>
      </>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[13px] shadow-md"
    >
      {body}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="ml-1 rounded-sm p-0.5 text-muted-foreground hover:bg-secondary"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

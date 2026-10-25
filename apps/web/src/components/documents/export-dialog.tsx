import type { ExportFormat, ExportJob } from "@jangka/shared/export";
import { useMutation } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createExport, formatLabels } from "@/lib/exports";
import { errorMessage } from "@/lib/form-errors";

type ExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  emptyCount: number;
  /** The appendix option only shows when there is something to list. */
  hasRequirements: boolean;
  onQueued: (job: ExportJob) => void;
};

const FORMATS: ExportFormat[] = ["pdf", "docx"];

export function ExportDialog({
  open,
  onOpenChange,
  documentId,
  emptyCount,
  hasRequirements,
  onQueued,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [includeCover, setIncludeCover] = useState(true);
  const [includeAppendix, setIncludeAppendix] = useState(true);

  const start = useMutation({
    mutationFn: () =>
      createExport(documentId, {
        format,
        includeCover,
        includeAppendix: hasRequirements && includeAppendix,
      }),
    onSuccess: (job) => {
      onOpenChange(false);
      onQueued(job);
    },
  });

  const { reset } = start;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  function submit(event: FormEvent) {
    event.preventDefault();
    start.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4 text-[13px]">
          {start.error && <ErrorBanner>{errorMessage(start.error)}</ErrorBanner>}
          <fieldset className="grid grid-cols-[72px_1fr] items-center gap-y-3">
            <legend className="sr-only">Export options</legend>
            <span className="font-medium">Format</span>
            <div className="flex gap-4" role="radiogroup" aria-label="Format">
              {FORMATS.map((option) => (
                <label key={option} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="export-format"
                    value={option}
                    checked={format === option}
                    onChange={() => setFormat(option)}
                    className="accent-primary"
                  />
                  {formatLabels[option]}
                </label>
              ))}
            </div>
            <span className="font-medium">Include</span>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={includeCover}
                onChange={(event) => setIncludeCover(event.target.checked)}
                className="accent-primary"
              />
              Cover page
            </label>
            {hasRequirements && (
              <label className="col-start-2 flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={includeAppendix}
                  onChange={(event) => setIncludeAppendix(event.target.checked)}
                  className="accent-primary"
                />
                Requirements appendix
              </label>
            )}
          </fieldset>
          {emptyCount > 0 && (
            <p className="flex items-start gap-2 rounded-sm bg-secondary px-3 py-2 text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-status-partial" aria-hidden />
              {emptyCount} section{emptyCount === 1 ? " is" : "s are"} empty and will show as
              placeholders.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={start.isPending}>
              Export
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { type TemplateFile, templateDetail } from "@jangka/shared/templates";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ErrorBanner } from "@/components/error-banner";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import type { PickedFile } from "@/lib/templates";
import { docTypeLabels } from "@/lib/trace";

const nameIssue = (error: unknown) =>
  error instanceof ApiError && error.code === "conflict" ? error.message : undefined;

export function ImportTemplateDialog({
  picked,
  onClose,
  onImported,
}: {
  picked: PickedFile;
  onClose: () => void;
  onImported: (templateId: string) => Promise<void>;
}) {
  // The parent keys this dialog per pick, so the name starts from each file.
  const [name, setName] = useState("file" in picked ? picked.file.name : "");

  const importing = useMutation({
    mutationFn: (file: TemplateFile) =>
      apiFetch("/admin/templates/import", {
        method: "POST",
        body: { name: name.trim(), file },
        schema: templateDetail,
      }),
    onSuccess: (draft) => onImported(draft.id),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if ("file" in picked && name.trim()) importing.mutate(picked.file);
  }

  const close = () => {
    importing.reset();
    onClose();
  };
  const conflict = nameIssue(importing.error);

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Import template</DialogTitle>
          <DialogDescription className="truncate">{picked.name}</DialogDescription>
        </DialogHeader>
        {"error" in picked ? (
          <>
            <ErrorBanner>{picked.error}</ErrorBanner>
            <DialogFooter>
              <Button onClick={close}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            {importing.error && !conflict && (
              <ErrorBanner>{errorMessage(importing.error)}</ErrorBanner>
            )}
            {"file" in picked && (
              <p className="text-sm text-muted-foreground">
                {docTypeLabels[picked.file.docType]} template · {picked.file.sections.length}{" "}
                section
                {picked.file.sections.length === 1 ? "" : "s"}. It's added as a draft you can review
                and publish.
              </p>
            )}
            <FormField
              id="import-template-name"
              label="Name"
              autoFocus
              maxLength={100}
              value={name}
              error={conflict}
              onChange={(event) => setName(event.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={importing.isPending || !name.trim()}>
                Import
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

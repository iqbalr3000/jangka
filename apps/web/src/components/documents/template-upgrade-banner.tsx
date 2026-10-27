import {
  documentDetail,
  type TemplateUpgradePreview,
  templateUpgradePreview,
} from "@jangka/shared/document";
import { REQUIREMENT_PREFIX } from "@jangka/templates";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { ErrorBanner } from "@/components/error-banner";
import { LoadingRows } from "@/components/loading-rows";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { chatQuery } from "@/lib/assistant";
import { documentQuery, documentsKey } from "@/lib/documents";
import { errorMessage } from "@/lib/form-errors";

type TemplateUpgradeBannerProps = {
  documentId: string;
  version: number;
  /** The assistant is working on this document: the server refuses until it's done. */
  busy: boolean;
};

/** "A newer version of this template is available" with a preview of what upgrading changes. */
export function TemplateUpgradeBanner({ documentId, version, busy }: TemplateUpgradeBannerProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-3 border-b border-border bg-secondary px-4 py-2 text-[13px] text-muted-foreground">
      <span className="flex-1">A newer version of this template is available (v{version}).</span>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        Review upgrade
      </Button>
      {open && <UpgradeDialog documentId={documentId} busy={busy} onClose={() => setOpen(false)} />}
    </div>
  );
}

function UpgradeDialog({
  documentId,
  busy,
  onClose,
}: {
  documentId: string;
  busy: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: [...documentQuery(documentId).queryKey, "template-upgrade"],
    queryFn: () =>
      apiFetch(`/documents/${documentId}/template-upgrade`, { schema: templateUpgradePreview }),
    staleTime: 0,
  });
  const upgrade = useMutation({
    mutationFn: (templateId: string) =>
      apiFetch(`/documents/${documentId}/template-upgrade`, {
        method: "POST",
        body: { templateId },
        schema: documentDetail,
      }),
    onSuccess: async (detail) => {
      queryClient.setQueryData(documentQuery(documentId).queryKey, detail);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: documentsKey }),
        queryClient.invalidateQueries({ queryKey: chatQuery(documentId).queryKey }),
      ]);
      onClose();
    },
  });

  const data = preview.data;
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Upgrade template</DialogTitle>
          <DialogDescription>
            {data
              ? `${data.from.name}: v${data.from.version} → v${data.to.version}. Section content doesn't change.`
              : "Section content doesn't change."}
          </DialogDescription>
        </DialogHeader>
        {preview.isPending && <LoadingRows />}
        {(preview.error ?? upgrade.error) && (
          <ErrorBanner>{errorMessage(preview.error ?? upgrade.error)}</ErrorBanner>
        )}
        {data && <Changes preview={data} />}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!data || busy || upgrade.isPending}
            title={busy ? "Wait for the assistant to finish" : undefined}
            onClick={() => data && upgrade.mutate(data.to.templateId)}
          >
            {upgrade.isPending ? "Upgrading…" : `Upgrade to v${data?.to.version ?? ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Changes({ preview }: { preview: TemplateUpgradePreview }) {
  const { added, retired, renamed, requirementChanges } = preview;
  const none = added.length + retired.length + renamed.length + requirementChanges.length === 0;
  if (none) {
    return (
      <p className="text-sm text-muted-foreground">
        The sections stay the same; only the assistant's guidance changes.
      </p>
    );
  }
  return (
    <div className="flex max-h-[50vh] flex-col gap-4 overflow-auto text-sm">
      {added.length > 0 && (
        <Group title="New sections" hint="Added empty, ready to write or draft.">
          {added.map((s) => (
            <li key={s.key}>{s.title}</li>
          ))}
        </Group>
      )}
      {retired.length > 0 && (
        <Group
          title="Removed from the template"
          hint="Sections with content stay at the end, marked “Removed from template”, until you clear them."
        >
          {retired.map((s) => (
            <li key={s.key}>
              {s.title}
              <span className="text-muted-foreground">
                {s.hasContent ? " · keeps its content" : " · empty, hidden"}
              </span>
            </li>
          ))}
        </Group>
      )}
      {renamed.length > 0 && (
        <Group title="Renamed">
          {renamed.map((s) => (
            <li key={s.key}>
              {s.from} → {s.to}
            </li>
          ))}
        </Group>
      )}
      {requirementChanges.length > 0 && (
        <Group title="Requirements">
          {requirementChanges.map((s) => (
            <li key={s.key}>
              {s.title}:{" "}
              {s.to === null
                ? "no longer collects requirements"
                : `now collects ${REQUIREMENT_PREFIX[s.to]}- requirements`}
              {s.from !== null && s.requirementCount > 0 && (
                <span className="block text-xs text-status-partial">
                  {s.requirementCount} {REQUIREMENT_PREFIX[s.from]}- requirement
                  {s.requirementCount === 1 ? "" : "s"} leave the index; documents citing them will
                  show them as missing.
                </span>
              )}
            </li>
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="font-medium">{title}</h3>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <ul className="list-disc pl-5">{children}</ul>
    </section>
  );
}

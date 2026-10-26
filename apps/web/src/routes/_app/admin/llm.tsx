import { type LLMProviderView, llmProvider, testResult } from "@jangka/shared/llm";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { ErrorBanner } from "@/components/error-banner";
import { AddProviderFlow } from "@/components/llm/add-provider-flow";
import { DefaultModelCard } from "@/components/llm/default-model-card";
import { EditProviderDialog } from "@/components/llm/edit-provider-dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { kindLabels, llmKey, llmProvidersQuery, providerStatus, timeAgo } from "@/lib/llm";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/admin/llm")({
  component: LlmProvidersPage,
});

const toneClass = {
  ok: "bg-status-complete",
  warn: "bg-status-partial",
  error: "bg-destructive",
  idle: "border border-status-empty",
} as const;

function LlmProvidersPage() {
  const queryClient = useQueryClient();
  const providers = useQuery(llmProvidersQuery);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LLMProviderView | null>(null);
  const [deleting, setDeleting] = useState<LLMProviderView | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: llmKey });

  const retest = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/admin/llm-providers/${id}/test`, { method: "POST", schema: testResult }),
    // Failures are recorded on the provider too, so refresh either way.
    onSettled: invalidate,
  });

  const setEnabled = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      apiFetch(`/admin/llm-providers/${input.id}`, {
        method: "PATCH",
        body: { enabled: input.enabled },
        schema: llmProvider,
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/admin/llm-providers/${id}`, { method: "DELETE", schema: z.undefined() }),
    onSuccess: async () => {
      setDeleting(null);
      await invalidate();
    },
  });

  const items = providers.data?.items ?? [];
  const hasDefault = items.some((p) => p.isDefault);
  const error = providers.error ?? retest.error ?? setEnabled.error;

  return (
    <div className="flex flex-col gap-6 px-10 pt-7 pb-10">
      <header className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Admin</span>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">LLM providers</h1>
          <p className="max-w-[620px] text-sm text-muted-foreground">
            Jangka sends interview, drafting and revision requests to these providers. Keys are
            encrypted at rest and never shown again.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)} disabled={!providers.data}>
          + Add provider
        </Button>
      </header>

      {error && <ErrorBanner>{errorMessage(error)}</ErrorBanner>}

      <DefaultModelCard providers={items} />

      <section aria-label="Providers" className="flex flex-col gap-2.5">
        <span className="font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground">
          PROVIDERS {items.length}
        </span>
        {providers.isPending && <LoadingRows />}
        {providers.data && items.length === 0 && (
          <p className="text-sm text-muted-foreground">No providers yet.</p>
        )}
        {items.length > 0 && (
          <div className="rounded-md border border-border bg-card">
            {items.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                testing={retest.isPending}
                onTest={() => retest.mutate(provider.id)}
                onEdit={() => setEditing(provider)}
                onToggle={() => setEnabled.mutate({ id: provider.id, enabled: !provider.enabled })}
                onDelete={() => setDeleting(provider)}
              />
            ))}
          </div>
        )}
      </section>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Add provider</DialogTitle>
          </DialogHeader>
          {adding && providers.data && (
            <AddProviderFlow
              fakeEnabled={providers.data.fakeEnabled}
              requireDefault={!hasDefault}
              onSaved={() => setAdding(false)}
              secondaryAction={
                <Button variant="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              }
            />
          )}
        </DialogContent>
      </Dialog>

      <EditProviderDialog provider={editing} onClose={() => setEditing(null)} />

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.label}”?</DialogTitle>
            <DialogDescription>
              The stored key is destroyed.
              {deleting?.isDefault &&
                " This is the default provider: drafting stops until you pick a new default."}
            </DialogDescription>
          </DialogHeader>
          {remove.error && <ErrorBanner>{errorMessage(remove.error)}</ErrorBanner>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              Delete provider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProviderRow({
  provider,
  testing,
  onTest,
  onEdit,
  onToggle,
  onDelete,
}: {
  provider: LLMProviderView;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const status = providerStatus(provider);
  return (
    <div
      className={cn(
        "flex items-center gap-4 border-b border-border px-4 py-3 text-sm last:border-b-0",
        !provider.enabled && "text-muted-foreground",
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-secondary font-semibold">
        {kindLabels[provider.kind][0]}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2 font-medium">
          {kindLabels[provider.kind]}
          {provider.isDefault && (
            <span className="rounded-sm border border-primary px-1.5 font-mono text-[11px] text-primary">
              Default
            </span>
          )}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {provider.label}
          {provider.keyLast4 && ` · ••••${provider.keyLast4}`}
          {provider.baseUrl && ` · ${provider.baseUrl}`}
        </span>
      </span>
      <span className="flex w-44 flex-col text-xs">
        <span className="flex items-center gap-1.5 text-sm">
          <span className={cn("size-2 rounded-full", toneClass[status.tone])} aria-hidden />
          {status.label}
        </span>
        {provider.lastTestedAt && (
          <span className="text-muted-foreground">Tested {timeAgo(provider.lastTestedAt)}</span>
        )}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary"
          aria-label={`Actions for ${provider.label}`}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="text-[13px]">
          <DropdownMenuItem disabled={testing} onSelect={onTest}>
            Test again
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>Edit…</DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggle}>
            {provider.enabled ? "Disable" : "Enable"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

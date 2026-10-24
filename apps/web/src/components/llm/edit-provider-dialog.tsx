import { type LLMProviderView, llmProvider } from "@jangka/shared/llm";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
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
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { kindLabels, llmKey } from "@/lib/llm";

type EditProviderDialogProps = { provider: LLMProviderView | null; onClose: () => void };

/** Rename, replace the key, or change the base URL; a new key or URL is tested before saving. */
export function EditProviderDialog({ provider, onClose }: EditProviderDialogProps) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const save = useMutation({
    mutationFn: (input: { id: string; body: Record<string, string | null> }) =>
      apiFetch(`/admin/llm-providers/${input.id}`, {
        method: "PATCH",
        body: input.body,
        schema: llmProvider,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: llmKey });
      onClose();
    },
  });

  const { reset } = save;
  useEffect(() => {
    setLabel(provider?.label ?? "");
    setApiKey("");
    setBaseUrl(provider?.baseUrl ?? "");
    reset();
  }, [provider, reset]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!provider) return;
    const body: Record<string, string | null> = {};
    if (label.trim() && label.trim() !== provider.label) body.label = label.trim();
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    if (provider.kind === "openai" && baseUrl.trim() !== (provider.baseUrl ?? "")) {
      body.baseUrl = baseUrl.trim() || null;
    }
    if (Object.keys(body).length === 0) return onClose();
    save.mutate({ id: provider.id, body });
  }

  return (
    <Dialog open={provider !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Edit {provider ? kindLabels[provider.kind] : ""} provider</DialogTitle>
          <DialogDescription>
            A new key or base URL is tested before it replaces the current one.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {save.error && <ErrorBanner>{errorMessage(save.error)}</ErrorBanner>}
          <FormField
            id="edit-provider-label"
            label="Label"
            maxLength={100}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          {provider?.kind !== "fake" && (
            <FormField
              id="edit-provider-key"
              label="Replace API key"
              type="password"
              autoComplete="off"
              className="font-mono"
              placeholder={provider?.keyLast4 ? `Current: ••••${provider.keyLast4}` : ""}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          )}
          {provider?.kind === "openai" && (
            <FormField
              id="edit-provider-base-url"
              label="Base URL (optional)"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

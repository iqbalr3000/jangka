import { type LLMProviderView, llmSettings, modelList } from "@jangka/shared/llm";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ErrorBanner } from "@/components/error-banner";
import { LoadingRows } from "@/components/loading-rows";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { kindLabels, llmKey, llmSettingsQuery } from "@/lib/llm";
import { ModelPicker } from "./model-picker";

type DefaultModelCardProps = { providers: LLMProviderView[] };

export function DefaultModelCard({ providers }: DefaultModelCardProps) {
  const queryClient = useQueryClient();
  const settings = useQuery(llmSettingsQuery);
  const enabled = providers.filter((p) => p.enabled);
  const [providerId, setProviderId] = useState<string>("");
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setProviderId(settings.data.providerId ?? "");
    setModel(settings.data.model);
  }, [settings.data]);

  const models = useQuery({
    queryKey: [...llmKey, "models", providerId],
    queryFn: () => apiFetch(`/admin/llm-providers/${providerId}/models`, { schema: modelList }),
    enabled: providerId !== "",
    staleTime: 5 * 60_000,
  });

  const save = useMutation({
    mutationFn: (body: { providerId: string; model: string }) =>
      apiFetch("/admin/settings/llm", { method: "PUT", body, schema: llmSettings }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: llmKey }),
  });

  const changed =
    providerId !== (settings.data?.providerId ?? "") || model !== (settings.data?.model ?? null);

  return (
    <section
      aria-label="Default model"
      className="flex flex-col gap-4 rounded-md border border-border bg-card p-5"
    >
      <div>
        <h2 className="text-base font-semibold">Default model</h2>
        <p className="text-[13px] text-muted-foreground">Used for every new document.</p>
      </div>
      {enabled.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Add a provider to choose a model.</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="default-provider" className="text-[13px] font-medium">
              Provider
            </Label>
            <select
              id="default-provider"
              value={providerId}
              onChange={(event) => {
                setProviderId(event.target.value);
                setModel(null);
              }}
              className="h-[34px] max-w-sm rounded-sm border border-input bg-card px-2 text-sm"
            >
              <option value="" disabled>
                Select a provider
              </option>
              {enabled.map((p) => (
                <option key={p.id} value={p.id}>
                  {kindLabels[p.kind]} · {p.label}
                </option>
              ))}
            </select>
          </div>
          {providerId && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="default-model" className="text-[13px] font-medium">
                Model
              </Label>
              {models.isPending && <LoadingRows rows={2} />}
              {models.error && <ErrorBanner>{errorMessage(models.error)}</ErrorBanner>}
              {models.data && (
                <ModelPicker
                  id="default-model"
                  models={models.data.models}
                  value={model}
                  onChange={setModel}
                />
              )}
            </div>
          )}
          {save.error && <ErrorBanner>{errorMessage(save.error)}</ErrorBanner>}
          <div>
            <Button
              size="sm"
              disabled={!changed || !providerId || !model || save.isPending}
              onClick={() => model && save.mutate({ providerId, model })}
            >
              Save default
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

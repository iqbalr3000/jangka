import {
  llmProvider,
  type ModelInfo,
  type ProviderKind,
  providerKind,
  testResult,
} from "@jangka/shared/llm";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { ErrorBanner } from "@/components/error-banner";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { keyPlaceholders, kindLabels, llmKey } from "@/lib/llm";
import { cn } from "@/lib/utils";
import { ModelPicker } from "./model-picker";

const STEP_TITLES = ["Provider", "API key", "Test connection", "Pick a default model"] as const;

type AddProviderFlowProps = {
  fakeEnabled: boolean;
  /** No default exists yet: the new provider's model becomes it. */
  requireDefault: boolean;
  onSaved: () => void;
  /** Left-hand footer action (Cancel / Skip for now). */
  secondaryAction: ReactNode;
};

function maskKey(key: string): string {
  return key.length <= 8 ? "••••" : `${key.slice(0, 7)}••••${key.slice(-4)}`;
}

/** Provider → key → test → default model, as in mockup 1f. Completed steps collapse. */
export function AddProviderFlow({
  fakeEnabled,
  requireDefault,
  onSaved,
  secondaryAction,
}: AddProviderFlowProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<ProviderKind | null>(null);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [makeDefault, setMakeDefault] = useState(requireDefault);
  const [keyError, setKeyError] = useState<string>();

  const connection = () => ({
    kind: kind ?? "openai",
    apiKey: apiKey.trim(),
    baseUrl: kind === "openai" && baseUrl.trim() ? baseUrl.trim() : null,
  });

  const test = useMutation({
    mutationFn: () =>
      apiFetch("/admin/llm-providers/test", {
        method: "POST",
        body: connection(),
        schema: testResult,
      }),
  });

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/admin/llm-providers", {
        method: "POST",
        body: {
          ...connection(),
          label: label.trim() || kindLabels[kind ?? "openai"],
          defaultModel: makeDefault ? model : null,
        },
        schema: llmProvider,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: llmKey });
      onSaved();
    },
  });

  function goTo(next: number) {
    if (next < 2) test.reset();
    save.reset();
    setStep(next);
  }

  function submitKey(event: FormEvent) {
    event.preventDefault();
    if (kind !== "fake" && apiKey.trim() === "") return setKeyError("Required");
    setKeyError(undefined);
    setStep(2);
    test.mutate();
  }

  const models: ModelInfo[] = test.data?.models ?? [];
  const kinds = providerKind.options.filter((k) => k !== "fake" || fakeEnabled);

  const summaries = [
    kind ? kindLabels[kind] : "",
    kind === "fake" && !apiKey ? "No key" : maskKey(apiKey.trim()),
    test.data ? `${models.length} models available` : "",
  ];

  return (
    <div className="flex flex-col gap-4">
      <span className="font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground">
        STEP {step + 1} OF 4
      </span>

      {STEP_TITLES.slice(0, step).map((title, index) => (
        <div key={title} className="flex items-center gap-3 text-[13px]">
          <Check className="size-3.5 text-status-complete" aria-hidden />
          <span className="w-28 text-muted-foreground">{title}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{summaries[index]}</span>
          {index < 2 && (
            <Button variant="link" size="xs" onClick={() => goTo(index)} className="h-auto px-0">
              Change
            </Button>
          )}
        </div>
      ))}

      <h3 className="text-sm font-semibold">{STEP_TITLES[step]}</h3>

      {step === 0 && (
        <>
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="sr-only">Provider</legend>
            {kinds.map((option) => (
              <label
                key={option}
                className={cn(
                  "cursor-pointer rounded-sm border border-border bg-card px-3 py-2.5 text-[13px] hover:bg-secondary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
                  kind === option && "border-primary font-medium text-primary",
                )}
              >
                <input
                  type="radio"
                  name="provider-kind"
                  value={option}
                  checked={kind === option}
                  onChange={() => setKind(option)}
                  className="sr-only"
                />
                {kindLabels[option]}
              </label>
            ))}
          </fieldset>
          <div className="flex justify-between">
            {secondaryAction}
            <Button disabled={!kind} onClick={() => goTo(1)}>
              Continue
            </Button>
          </div>
        </>
      )}

      {step === 1 && kind && (
        <form onSubmit={submitKey} noValidate className="flex flex-col gap-4">
          <FormField
            id="provider-label"
            label="Label"
            placeholder={kindLabels[kind]}
            hint="To tell keys apart, e.g. “Production key”."
            maxLength={100}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <FormField
            id="provider-key"
            label="API key"
            type="password"
            autoComplete="off"
            autoFocus
            placeholder={keyPlaceholders[kind]}
            hint="Encrypted at rest. Only the last 4 characters are ever shown again."
            className="font-mono"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            error={keyError}
          />
          {kind === "openai" && (
            <FormField
              id="provider-base-url"
              label="Base URL (optional)"
              placeholder="https://api.openai.com/v1"
              hint="For OpenAI-compatible servers, e.g. http://localhost:11434/v1 for Ollama."
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          )}
          <div className="flex justify-between">
            {secondaryAction}
            <Button type="submit">Test connection</Button>
          </div>
        </form>
      )}

      {step === 2 && (
        <>
          {test.isPending && <p className="text-[13px] text-muted-foreground">Testing…</p>}
          {test.error && <ErrorBanner>{errorMessage(test.error)}</ErrorBanner>}
          {test.data && (
            <p className="flex items-center gap-2 text-[13px]">
              <span className="size-2 rounded-full bg-status-complete" aria-hidden />
              <span className="font-medium">Connected</span>
              <span className="text-muted-foreground">
                {test.data.models.length} models available · responded in {test.data.latencyMs} ms
              </span>
            </p>
          )}
          <div className="flex items-center justify-between">
            {secondaryAction}
            <div className="flex gap-2">
              <Button variant="ghost" disabled={test.isPending} onClick={() => test.mutate()}>
                Test again
              </Button>
              <Button disabled={!test.data} onClick={() => goTo(3)}>
                Continue
              </Button>
            </div>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          {save.error && <ErrorBanner>{errorMessage(save.error)}</ErrorBanner>}
          <ModelPicker id="provider-model" models={models} value={model} onChange={setModel} />
          {!requireDefault && (
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={makeDefault}
                onChange={(event) => setMakeDefault(event.target.checked)}
              />
              Make this the default model
            </label>
          )}
          <div className="flex justify-between">
            {secondaryAction}
            <Button
              disabled={save.isPending || (makeDefault && model === null)}
              onClick={() => save.mutate()}
            >
              Save provider
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

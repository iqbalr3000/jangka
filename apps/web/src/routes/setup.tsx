import { meResponse, passwordSchema, setupRequest } from "@jangka/shared/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { z } from "zod";
import { CopyButton } from "@/components/copy-button";
import { ErrorBanner } from "@/components/error-banner";
import { FormField } from "@/components/form-field";
import { AddProviderFlow } from "@/components/llm/add-provider-flow";
import { PublicPage } from "@/components/public-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wordmark } from "@/components/wordmark";
import { ApiError, apiFetch } from "@/lib/api";
import { errorMessage, type FieldErrors, fieldErrors } from "@/lib/form-errors";
import { llmProvidersQuery } from "@/lib/llm";
import { meQuery, setupStatusQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/setup")({
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.ensureQueryData(setupStatusQuery);
    if (status.completed) throw redirect({ to: "/" });
  },
  component: SetupPage,
});

const steps = ["Token", "Organization", "Admin", "LLM (optional)"] as const;
const LOG_COMMAND = 'docker logs jangka | grep "SETUP TOKEN"';

const adminStep = setupRequest
  .pick({ adminName: true, adminEmail: true })
  .extend({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], error: "Passwords don't match" });

function Stepper({ current }: { current: number }) {
  return (
    <ol className="relative flex" aria-label="Setup progress">
      <span
        className="absolute top-1.5 right-[60px] left-[60px] h-px bg-status-empty"
        aria-hidden
      />
      {steps.map((label, index) => (
        <li
          key={label}
          className="relative flex w-[120px] flex-col items-center gap-2"
          aria-current={index === current ? "step" : undefined}
        >
          <span
            className={cn(
              "size-3 rounded-full",
              index <= current ? "bg-primary" : "border-[1.5px] border-status-empty bg-card",
            )}
          />
          <span
            className={cn("text-xs", index === current ? "font-medium" : "text-muted-foreground")}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function SetupPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [form, setForm] = useState({
    token: "",
    orgName: "",
    adminName: "",
    adminEmail: "",
    password: "",
    confirm: "",
  });

  // Step 4 runs signed in as the new admin, so admin endpoints work.
  const llmProviders = useQuery({ ...llmProvidersQuery, enabled: step === 3 });
  const finish = () => navigate({ to: "/" });

  const update = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  function submitToken(event: FormEvent) {
    event.preventDefault();
    const token = form.token.trim();
    if (!token) return setErrors({ token: "Paste the token from the logs" });
    void run(async () => {
      try {
        await apiFetch("/setup/verify-token", {
          method: "POST",
          body: { token },
          schema: z.undefined(),
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === "invalid_setup_token") {
          setErrors({ token: "This token doesn't match. Use the latest one from the logs." });
          return;
        }
        throw err;
      }
      setErrors({});
      setStep(1);
    });
  }

  function submitOrg(event: FormEvent) {
    event.preventDefault();
    const parsed = setupRequest.shape.orgName.safeParse(form.orgName);
    if (!parsed.success) return setErrors({ orgName: parsed.error.issues[0]?.message ?? "" });
    setErrors({});
    setStep(2);
  }

  function submitAdmin(event: FormEvent) {
    event.preventDefault();
    const parsed = adminStep.safeParse(form);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    void run(async () => {
      const me = await apiFetch("/setup", {
        method: "POST",
        body: {
          token: form.token.trim(),
          orgName: form.orgName,
          adminName: form.adminName,
          adminEmail: form.adminEmail,
          password: form.password,
        },
        schema: meResponse,
      }).catch((err: unknown) => {
        // The server restarted and issued a new token: go back to step 1 with a clear hint.
        if (err instanceof ApiError && err.code === "invalid_setup_token") {
          setStep(0);
          setErrors({ token: "This token is no longer valid. Use the latest one from the logs." });
          return null;
        }
        throw err;
      });
      if (!me) return;
      queryClient.setQueryData(setupStatusQuery.queryKey, { completed: true });
      queryClient.setQueryData(meQuery.queryKey, me);
      setStep(3);
    });
  }

  return (
    <PublicPage>
      <Wordmark className="text-[28px]" />
      <Stepper current={step} />

      <div className="flex w-full max-w-[480px] flex-col gap-4 rounded-md border border-border bg-card p-7">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        {step === 0 && (
          <form onSubmit={submitToken} className="flex flex-col gap-4" noValidate>
            <div>
              <h1 className="text-xl font-semibold">Setup token</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Confirms you control this server.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Input
                aria-label="Setup token"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="jk_setup_…"
                value={form.token}
                onChange={update("token")}
                aria-invalid={errors.token ? true : undefined}
                className="h-10 bg-card font-mono text-sm"
              />
              {errors.token && <p className="text-xs text-destructive">{errors.token}</p>}
            </div>
            <p className="text-[13px] text-muted-foreground">Find it in the container logs:</p>
            <div className="flex items-center justify-between gap-3 rounded-sm border border-border bg-secondary px-3 py-2.5 font-mono text-[13px]">
              <span className="truncate">{LOG_COMMAND}</span>
              <CopyButton value={LOG_COMMAND} className="font-sans" />
            </div>
            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={pending}>
                Continue
              </Button>
            </div>
          </form>
        )}

        {step === 1 && (
          <form onSubmit={submitOrg} className="flex flex-col gap-4" noValidate>
            <div>
              <h1 className="text-xl font-semibold">Organization</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Shown in the sidebar and on exported documents.
              </p>
            </div>
            <FormField
              id="orgName"
              label="Organization name"
              autoFocus
              placeholder="Acme Payments"
              value={form.orgName}
              onChange={update("orgName")}
              error={errors.orgName}
            />
            <div className="flex justify-between pt-2">
              <Button type="button" variant="ghost" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button type="submit">Continue</Button>
            </div>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={submitAdmin} className="flex flex-col gap-4" noValidate>
            <div>
              <h1 className="text-xl font-semibold">Admin account</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                You can invite the rest of your team after setup.
              </p>
            </div>
            <FormField
              id="adminName"
              label="Name"
              autoFocus
              autoComplete="name"
              value={form.adminName}
              onChange={update("adminName")}
              error={errors.adminName}
            />
            <FormField
              id="adminEmail"
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="name@company.com"
              value={form.adminEmail}
              onChange={update("adminEmail")}
              error={errors.adminEmail}
            />
            <FormField
              id="password"
              label="Password"
              type="password"
              autoComplete="new-password"
              hint="At least 12 characters."
              value={form.password}
              onChange={update("password")}
              error={errors.password}
            />
            <FormField
              id="confirm"
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={update("confirm")}
              error={errors.confirm}
            />
            <div className="flex justify-between pt-2">
              <Button type="button" variant="ghost" onClick={() => setStep(1)} disabled={pending}>
                Back
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Finish setup"}
              </Button>
            </div>
          </form>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-xl font-semibold">Connect an LLM</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Jangka drafts with your own provider key. You can do this later in Admin → LLM
                providers.
              </p>
            </div>
            {llmProviders.error && <ErrorBanner>{errorMessage(llmProviders.error)}</ErrorBanner>}
            {llmProviders.data && (
              <AddProviderFlow
                fakeEnabled={llmProviders.data.fakeEnabled}
                requireDefault
                onSaved={() => void finish()}
                secondaryAction={
                  <Button type="button" variant="ghost" onClick={() => void finish()}>
                    Skip for now
                  </Button>
                }
              />
            )}
          </div>
        )}
      </div>
    </PublicPage>
  );
}

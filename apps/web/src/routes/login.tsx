import { loginRequest, meResponse, ssoError } from "@jangka/shared/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { z } from "zod";
import { ErrorBanner } from "@/components/error-banner";
import { FormField } from "@/components/form-field";
import { PublicPage } from "@/components/public-page";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { meQuery, safeRedirect, setupStatusQuery } from "@/lib/queries";
import { authOptionsQuery, ssoErrorMessage, ssoStartUrl } from "@/lib/sso";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({
    redirect: z.string().optional(),
    sso_error: ssoError.optional().catch(undefined),
    email: z.string().optional(),
  }),
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.ensureQueryData(setupStatusQuery);
    if (!status.completed) throw redirect({ to: "/setup" });
  },
  component: LoginPage,
});

function LoginPage() {
  const { redirect: target, sso_error: ssoFailure, email: ssoEmail } = Route.useSearch();
  const queryClient = useQueryClient();
  const options = useQuery(authOptionsQuery);
  const providers = options.data?.providers ?? [];
  const passwordEnabled = options.data?.passwordLoginEnabled ?? true;
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = loginRequest.safeParse({ email, password });
    if (!parsed.success) {
      setError("Enter your email and password.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const me = await apiFetch("/auth/login", {
        method: "POST",
        body: parsed.data,
        schema: meResponse,
      });
      queryClient.setQueryData(meQuery.queryKey, me);
      await navigate({ to: safeRedirect(target) });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <PublicPage>
      <form
        onSubmit={(event) => void submit(event)}
        noValidate
        className="flex w-full max-w-[400px] flex-col gap-4 rounded-md border border-border bg-card p-8 text-sm"
      >
        <Wordmark className="text-2xl" />
        <p className="-mt-1.5 text-muted-foreground">
          Precise specs for product & engineering teams.
        </p>
        {ssoFailure && !error && <ErrorBanner>{ssoErrorMessage(ssoFailure, ssoEmail)}</ErrorBanner>}
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {providers.length > 0 && (
          <div className="flex flex-col gap-2">
            {providers.map((provider) => (
              <Button key={provider.id} variant="outline" className="h-10" asChild>
                <a href={ssoStartUrl(provider.id, safeRedirect(target))}>
                  Continue with {provider.kind === "google" ? "Google" : provider.name}
                </a>
              </Button>
            ))}
          </div>
        )}
        {providers.length > 0 && passwordEnabled && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        )}
        {passwordEnabled && (
          <>
            <FormField
              id="email"
              label="Email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="name@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <FormField
              id="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button type="submit" className="mt-1 h-10" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Forgot your password? Ask an admin for a reset link.
            </p>
          </>
        )}
      </form>
    </PublicPage>
  );
}

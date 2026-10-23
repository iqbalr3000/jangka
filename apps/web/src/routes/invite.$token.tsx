import {
  acceptInviteRequest,
  type InviteInfo,
  inviteInfoResponse,
  meResponse,
  passwordSchema,
} from "@jangka/shared/auth";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { z } from "zod";
import { ErrorBanner } from "@/components/error-banner";
import { FormField } from "@/components/form-field";
import { PublicPage } from "@/components/public-page";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { ApiError, apiFetch } from "@/lib/api";
import { errorMessage, type FieldErrors, fieldErrors } from "@/lib/form-errors";
import { meQuery } from "@/lib/queries";

export const Route = createFileRoute("/invite/$token")({
  loader: async ({ params }): Promise<InviteInfo | null> => {
    try {
      return await apiFetch(`/invites/${encodeURIComponent(params.token)}`, {
        schema: inviteInfoResponse,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === "invite_invalid") return null;
      throw error;
    }
  },
  component: InvitePage,
});

const passwordForm = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], error: "Passwords don't match" });

function InvitePage() {
  const invite = Route.useLoaderData();
  return (
    <PublicPage>
      <div className="flex w-full max-w-[400px] flex-col gap-4 rounded-md border border-border bg-card p-8 text-sm">
        <Wordmark className="text-2xl" />
        {invite ? (
          <InviteForm invite={invite} />
        ) : (
          <>
            <h1 className="text-xl font-semibold">Link expired</h1>
            <p className="text-muted-foreground">
              This link was already used or has expired. Ask your admin for a new one.
            </p>
            <Link to="/login" className="text-primary hover:underline">
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </PublicPage>
  );
}

function InviteForm({ invite }: { invite: InviteInfo }) {
  const { token } = Route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isInvite = invite.kind === "invite";
  const [form, setForm] = useState({ name: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const update = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checks = passwordForm.safeParse(form);
    const body = acceptInviteRequest.safeParse({
      name: isInvite ? form.name : undefined,
      password: form.password,
    });
    const nextErrors = {
      ...(checks.success ? {} : fieldErrors(checks.error)),
      ...(body.success ? {} : fieldErrors(body.error)),
    };
    if (isInvite && !form.name.trim()) nextErrors.name = "Required";
    setErrors(nextErrors);
    if (!body.success || !checks.success || Object.keys(nextErrors).length > 0) return;

    setPending(true);
    setError(null);
    try {
      const me = await apiFetch(`/invites/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        body: body.data,
        schema: meResponse,
      });
      queryClient.setQueryData(meQuery.queryKey, me);
      await navigate({ to: "/" });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">
          {isInvite ? `Join ${invite.orgName}` : "Set a new password"}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {isInvite ? invite.email : `For ${invite.name ?? invite.email} (${invite.email})`}
        </p>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {isInvite && (
        <FormField
          id="name"
          label="Name"
          autoFocus
          autoComplete="name"
          value={form.name}
          onChange={update("name")}
          error={errors.name}
        />
      )}
      <FormField
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        autoFocus={!isInvite}
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
      <Button type="submit" className="mt-1 h-10" disabled={pending}>
        {pending ? "Saving…" : isInvite ? "Create account" : "Set password"}
      </Button>
    </form>
  );
}

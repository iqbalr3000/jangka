import { type AuthProviderView, authProviderView } from "@jangka/shared/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { AuthProviderDialog } from "@/components/admin/auth-provider-dialog";
import { LoginSettingsCard } from "@/components/admin/login-settings-card";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { authAdminKey, authOptionsQuery, authProvidersQuery } from "@/lib/sso";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/admin/auth")({
  component: AuthenticationPage,
});

function AuthenticationPage() {
  const queryClient = useQueryClient();
  const providers = useQuery(authProvidersQuery);
  const [dialog, setDialog] = useState<AuthProviderView | "new" | null>(null);
  const [deleting, setDeleting] = useState<AuthProviderView | null>(null);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: authAdminKey });
    await queryClient.invalidateQueries({ queryKey: authOptionsQuery.queryKey });
  };

  const test = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/admin/auth-providers/${id}/test`, {
        method: "POST",
        schema: z.object({ ok: z.boolean() }),
      }),
  });

  const setEnabled = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      apiFetch(`/admin/auth-providers/${input.id}`, {
        method: "PATCH",
        body: { enabled: input.enabled },
        schema: authProviderView,
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/admin/auth-providers/${id}`, { method: "DELETE", schema: z.undefined() }),
    onSuccess: async () => {
      setDeleting(null);
      await invalidate();
    },
  });

  const items = providers.data?.items ?? [];
  const error = providers.error ?? test.error ?? setEnabled.error;

  return (
    <div className="flex flex-col gap-6 px-10 pt-7 pb-10">
      <header className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Admin</span>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Authentication</h1>
          <p className="max-w-[620px] text-sm text-muted-foreground">
            Let people sign in with Google or any OpenID Connect provider. Client secrets are
            encrypted at rest and never shown again.
          </p>
        </div>
        <Button size="sm" onClick={() => setDialog("new")} disabled={!providers.data}>
          + Add provider
        </Button>
      </header>

      {error && <ErrorBanner>{errorMessage(error)}</ErrorBanner>}
      {test.isSuccess && (
        <p role="status" className="text-sm text-status-complete">
          The provider's OpenID configuration was read successfully.
        </p>
      )}

      <section aria-label="SSO providers" className="flex flex-col gap-2.5">
        <span className="font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground">
          PROVIDERS {items.length}
        </span>
        {providers.isPending && <LoadingRows />}
        {providers.data && items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No providers yet. People sign in with their password.
          </p>
        )}
        {items.length > 0 && (
          <div className="rounded-md border border-border bg-card">
            {items.map((provider) => (
              <SsoProviderRow
                key={provider.id}
                provider={provider}
                testing={test.isPending}
                onTest={() => test.mutate(provider.id)}
                onEdit={() => setDialog(provider)}
                onToggle={() => setEnabled.mutate({ id: provider.id, enabled: !provider.enabled })}
                onDelete={() => setDeleting(provider)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <span className="font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground">
          SIGN-IN
        </span>
        <LoginSettingsCard />
      </section>

      <AuthProviderDialog
        target={dialog}
        redirectUri={providers.data?.redirectUri ?? ""}
        onClose={() => setDialog(null)}
      />

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              Its {deleting?.linkedUsers ?? 0} linked sign-ins are removed. Accounts stay; those
              users can sign in another way or be linked again later.
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
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SsoProviderRow({
  provider,
  testing,
  onTest,
  onEdit,
  onToggle,
  onDelete,
}: {
  provider: AuthProviderView;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const domains = provider.allowedDomains.length
    ? provider.allowedDomains.join(", ")
    : "any domain";
  return (
    <div
      className={cn(
        "flex items-center gap-4 border-b border-border px-4 py-3 text-sm last:border-b-0",
        !provider.enabled && "text-muted-foreground",
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-secondary font-semibold">
        {provider.name[0]?.toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2 font-medium">
          {provider.name}
          {!provider.enabled && (
            <span className="rounded-sm border border-border px-1.5 text-[11px]">Disabled</span>
          )}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {provider.kind === "google" ? "Google" : provider.issuer} · ••••{provider.secretLast4} ·{" "}
          {domains}
          {provider.autoProvision && " · creates accounts"}
        </span>
      </span>
      <span className="w-28 text-xs text-muted-foreground">
        {provider.linkedUsers} linked user{provider.linkedUsers === 1 ? "" : "s"}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary"
          aria-label={`Actions for ${provider.name}`}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="text-[13px]">
          <DropdownMenuItem disabled={testing} onSelect={onTest}>
            Test discovery
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

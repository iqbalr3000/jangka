import {
  type AuthProviderKind,
  type AuthProviderView,
  authProviderView,
  createAuthProviderRequest,
  GOOGLE_ISSUER,
  updateAuthProviderRequest,
} from "@jangka/shared/auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { CopyButton } from "@/components/copy-button";
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
import { errorMessage, type FieldErrors, fieldErrors } from "@/lib/form-errors";
import { authAdminKey } from "@/lib/sso";
import { cn } from "@/lib/utils";

type AuthProviderDialogProps = {
  /** `null` = closed; `"new"` = add; a provider = edit. */
  target: AuthProviderView | "new" | null;
  redirectUri: string;
  onClose: () => void;
};

const KINDS: { value: AuthProviderKind; label: string }[] = [
  { value: "google", label: "Google" },
  { value: "oidc", label: "OpenID Connect" },
];

const splitDomains = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((d) => d.trim())
    .filter(Boolean);

/** Add or edit an SSO provider; discovery must succeed before it's saved. */
export function AuthProviderDialog({ target, redirectUri, onClose }: AuthProviderDialogProps) {
  const queryClient = useQueryClient();
  const editing = target !== null && target !== "new" ? target : null;
  const [kind, setKind] = useState<AuthProviderKind>("google");
  const [name, setName] = useState("Google");
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [domains, setDomains] = useState("");
  const [autoProvision, setAutoProvision] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? apiFetch(`/admin/auth-providers/${editing.id}`, {
            method: "PATCH",
            body,
            schema: authProviderView,
          })
        : apiFetch("/admin/auth-providers", { method: "POST", body, schema: authProviderView }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authAdminKey });
      onClose();
    },
  });

  const { reset } = save;
  useEffect(() => {
    if (target === null) return;
    reset();
    setErrors({});
    setClientSecret("");
    if (target === "new") {
      setKind("google");
      setName("Google");
      setIssuer("");
      setClientId("");
      setDomains("");
      setAutoProvision(false);
    } else {
      setKind(target.kind);
      setName(target.name);
      setIssuer(target.issuer);
      setClientId(target.clientId);
      setDomains(target.allowedDomains.join(", "));
      setAutoProvision(target.autoProvision);
    }
  }, [target, reset]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const fields = {
      name,
      issuer: kind === "google" ? GOOGLE_ISSUER : issuer,
      clientId,
      allowedDomains: splitDomains(domains),
      autoProvision,
    };
    // Editing: an empty secret keeps the stored one.
    const parsed = editing
      ? updateAuthProviderRequest.safeParse(clientSecret ? { ...fields, clientSecret } : fields)
      : createAuthProviderRequest.safeParse({ ...fields, kind, clientSecret, enabled: true });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    save.mutate(parsed.data);
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "Add SSO provider"}</DialogTitle>
          <DialogDescription>
            Register this redirect URI with the provider, then paste the client credentials.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4 text-sm">
          {save.error && <ErrorBanner>{errorMessage(save.error)}</ErrorBanner>}
          <div className="flex items-center gap-2 rounded-sm bg-secondary px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{redirectUri}</code>
            <CopyButton value={redirectUri} />
          </div>
          {!editing && (
            <div className="flex gap-2" role="radiogroup" aria-label="Provider type">
              {KINDS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex-1 cursor-pointer rounded-sm border px-3 py-2 text-[13px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
                    kind === option.value
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary",
                  )}
                >
                  <input
                    type="radio"
                    name="provider-kind"
                    className="sr-only"
                    checked={kind === option.value}
                    onChange={() => {
                      setKind(option.value);
                      setName(option.value === "google" ? "Google" : "");
                    }}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          )}
          <FormField
            id="provider-name"
            label="Name"
            hint='Shown on the login page as "Continue with …".'
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errors.name}
          />
          {kind === "oidc" && (
            <FormField
              id="provider-issuer"
              label="Issuer URL"
              placeholder="https://login.example.com/realms/acme"
              value={issuer}
              onChange={(event) => setIssuer(event.target.value)}
              error={errors.issuer}
            />
          )}
          <FormField
            id="provider-client-id"
            label="Client ID"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            error={errors.clientId}
          />
          <FormField
            id="provider-client-secret"
            label="Client secret"
            type="password"
            autoComplete="off"
            placeholder={editing ? `••••${editing.secretLast4} (leave empty to keep)` : ""}
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            error={errors.clientSecret}
          />
          <FormField
            id="provider-domains"
            label="Allowed email domains"
            placeholder="acme.co, acme.io"
            hint="Leave empty to allow any domain."
            value={domains}
            onChange={(event) => setDomains(event.target.value)}
            error={errors.allowedDomains}
          />
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5 accent-primary"
              checked={autoProvision}
              onChange={(event) => setAutoProvision(event.target.checked)}
            />
            <span>
              Create accounts for new users automatically
              <span className="block text-xs text-muted-foreground">
                They join the default group set below.
              </span>
            </span>
          </label>
          <p className="flex items-start gap-2 rounded-sm bg-secondary px-3 py-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-status-partial" aria-hidden />A
            sign-in whose email the provider reports as verified links to the existing Jangka
            account with that email, admins included. Only add providers you trust to verify emails.
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Checking provider…" : editing ? "Save" : "Add provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

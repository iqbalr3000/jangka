import { instanceSettingsView } from "@jangka/shared/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorBanner } from "@/components/error-banner";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { adminGroupsQuery, authAdminKey, authOptionsQuery, instanceSettingsQuery } from "@/lib/sso";

const NO_GROUP = "";

/** Password login on/off (with the lockout guard's reason) and the group for new SSO users. */
export function LoginSettingsCard() {
  const queryClient = useQueryClient();
  const settings = useQuery(instanceSettingsQuery);
  const groups = useQuery(adminGroupsQuery);

  const update = useMutation({
    mutationFn: (body: { passwordLoginEnabled?: boolean; defaultGroupId?: string | null }) =>
      apiFetch("/admin/settings", { method: "PUT", body, schema: instanceSettingsView }),
    onSuccess: async (view) => {
      queryClient.setQueryData(instanceSettingsQuery.queryKey, view);
      await queryClient.invalidateQueries({ queryKey: authAdminKey });
      await queryClient.invalidateQueries({ queryKey: authOptionsQuery.queryKey });
    },
  });

  if (!settings.data) {
    return settings.error ? <ErrorBanner>{errorMessage(settings.error)}</ErrorBanner> : null;
  }
  const view = settings.data;
  // Turning it off is what the guard limits; turning it back on is always allowed.
  const blocked = view.passwordLoginEnabled && view.disablePasswordLoginBlocker !== null;
  const customGroups = (groups.data?.items ?? []).filter((g) => g.systemKey === null);

  return (
    <section
      aria-label="Login settings"
      className="flex flex-col gap-4 rounded-md border border-border bg-card p-4 text-sm"
    >
      {update.error && <ErrorBanner>{errorMessage(update.error)}</ErrorBanner>}
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 accent-primary"
          checked={view.passwordLoginEnabled}
          disabled={blocked || update.isPending}
          onChange={(event) => update.mutate({ passwordLoginEnabled: event.target.checked })}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">Allow password sign-in</span>
          <span className="text-xs text-muted-foreground">
            {blocked ? view.disablePasswordLoginBlocker : "When off, everyone signs in with SSO."}
            {view.passwordLoginForced &&
              " Password sign-in is forced on by FORCE_PASSWORD_LOGIN on the server."}
          </span>
        </span>
      </label>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="default-group" className="font-medium">
          Default group for new SSO users
        </label>
        <select
          id="default-group"
          value={view.defaultGroupId ?? NO_GROUP}
          disabled={update.isPending}
          onChange={(event) =>
            update.mutate({
              defaultGroupId: event.target.value === NO_GROUP ? null : event.target.value,
            })
          }
          className="h-[38px] max-w-sm rounded-sm border border-input bg-card px-2"
        >
          <option value={NO_GROUP}>None (All Users only)</option>
          {customGroups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          Applies to accounts created automatically by providers with that option on.
        </span>
      </div>
    </section>
  );
}

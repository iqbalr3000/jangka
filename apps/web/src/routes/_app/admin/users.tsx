import {
  type AdminUser,
  adminUserList,
  type PendingInvite,
  pendingInviteList,
} from "@jangka/shared/auth";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { InviteDialog } from "@/components/admin/invite-dialog";
import { ResetLinkDialog } from "@/components/admin/reset-link-dialog";
import { ErrorBanner } from "@/components/error-banner";
import { LoadingRows } from "@/components/loading-rows";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/admin/users")({
  component: UsersPage,
});

const usersKey = ["admin", "users"] as const;
const invitesKey = ["admin", "invites"] as const;
const columns = "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_90px_120px_150px_32px] gap-4";
const headerClass = "font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground";

function UsersPage() {
  const { me } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);

  const users = useInfiniteQuery({
    queryKey: usersKey,
    queryFn: ({ pageParam }) =>
      apiFetch(`/admin/users?limit=50${pageParam ? `&cursor=${pageParam}` : ""}`, {
        schema: adminUserList,
      }),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const invites = useQuery({
    queryKey: invitesKey,
    queryFn: () => apiFetch("/admin/invites", { schema: pendingInviteList }),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch(`/admin/users/${id}`, {
        method: "PATCH",
        body: { isActive },
        schema: z.object({ id: z.string(), isActive: z.boolean() }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKey }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/admin/invites/${id}`, { method: "DELETE", schema: z.undefined() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invitesKey }),
  });

  const rows = users.data?.pages.flatMap((page) => page.items) ?? [];
  const mutationError = setActive.error ?? revoke.error;

  return (
    <div className="flex flex-col gap-6 px-10 pt-7 pb-10">
      <header className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Admin</span>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Users & invites</h1>
          <p className="max-w-[620px] text-sm text-muted-foreground">
            People who can sign in to Jangka. Invite and reset links work once and expire after 7
            days.
          </p>
        </div>
        <InviteDialog />
      </header>

      {mutationError && <ErrorBanner>{errorMessage(mutationError)}</ErrorBanner>}

      <section className="rounded-md border border-border bg-card" aria-label="Users">
        <div className={cn(columns, headerClass, "border-b border-border px-4 py-2.5")}>
          <span>NAME</span>
          <span>EMAIL</span>
          <span>ROLE</span>
          <span>STATUS</span>
          <span>LAST SIGN-IN</span>
          <span className="sr-only">Actions</span>
        </div>
        {users.isPending && <LoadingRows className="px-4 py-3" />}
        {users.error && (
          <div className="p-4">
            <ErrorBanner>{errorMessage(users.error)}</ErrorBanner>
          </div>
        )}
        {rows.map((user) => (
          <div
            key={user.id}
            className={cn(
              columns,
              "items-center border-b border-border px-4 py-3 text-sm last:border-b-0",
              !user.isActive && "text-muted-foreground",
            )}
          >
            <span className="truncate font-medium">
              {user.name}
              {user.id === me.user.id && (
                <span className="font-normal text-muted-foreground"> (you)</span>
              )}
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{user.email}</span>
              {user.identities.map((provider) => (
                <span
                  key={provider}
                  title={`Signs in with ${provider}`}
                  className="shrink-0 rounded-sm border border-border px-1.5 text-[11px] text-muted-foreground"
                >
                  {provider}
                </span>
              ))}
            </span>
            <span>{user.isAdmin ? "Admin" : "Member"}</span>
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "size-2 rounded-full",
                  user.isActive ? "bg-status-complete" : "border border-status-empty",
                )}
                aria-hidden
              />
              {user.isActive ? "Active" : "Deactivated"}
            </span>
            <span className="text-muted-foreground">
              {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary"
                aria-label={`Actions for ${user.name}`}
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="text-[13px]">
                <DropdownMenuItem disabled={!user.isActive} onSelect={() => setResetFor(user)}>
                  Create password reset link
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={user.id === me.user.id || setActive.isPending}
                  variant={user.isActive ? "destructive" : "default"}
                  onSelect={() => setActive.mutate({ id: user.id, isActive: !user.isActive })}
                >
                  {user.isActive ? "Deactivate" : "Reactivate"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        {users.hasNextPage && (
          <div className="border-t border-border p-3 text-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={users.isFetchingNextPage}
              onClick={() => void users.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2.5" aria-label="Pending invites">
        <div className="flex items-baseline gap-2">
          <span className={headerClass}>PENDING INVITES</span>
          <span className="font-mono text-[11px] text-status-empty">
            {invites.data?.items.length ?? 0}
          </span>
        </div>
        {invites.data?.items.length === 0 && (
          <p className="text-sm text-muted-foreground">No pending invites.</p>
        )}
        {invites.data && invites.data.items.length > 0 && (
          <div className="rounded-md border border-border bg-card">
            {invites.data.items.map((invite: PendingInvite) => (
              <div
                key={invite.id}
                className="flex items-center gap-4 border-b border-border px-4 py-3 text-sm last:border-b-0"
              >
                <span className="flex-1 truncate">{invite.email}</span>
                <span className="text-muted-foreground">
                  Expires {formatDate(invite.expiresAt)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(invite.id)}
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <ResetLinkDialog user={resetFor} onClose={() => setResetFor(null)} />
    </div>
  );
}

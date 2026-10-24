import { groupMemberList } from "@jangka/shared/access";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { AddMemberDialog } from "@/components/admin/add-member-dialog";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";

export const Route = createFileRoute("/_app/admin/groups/$groupId")({
  component: GroupMembersPage,
});

function GroupMembersPage() {
  const { me } = Route.useRouteContext();
  const { groupId } = Route.useParams();
  const queryClient = useQueryClient();

  const members = useQuery({
    queryKey: ["admin", "groups", groupId, "members"],
    queryFn: () => apiFetch(`/admin/groups/${groupId}/members`, { schema: groupMemberList }),
  });

  const remove = useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/admin/groups/${groupId}/members/${userId}`, {
        method: "DELETE",
        schema: z.undefined(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });

  const data = members.data;
  const isAdmins = data?.group.systemKey === "admins";
  const error = members.error ?? remove.error;

  return (
    <div className="flex flex-col gap-6 px-10 pt-7 pb-10">
      <header className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            <Link to="/admin/groups" className="hover:text-foreground">
              Groups
            </Link>
          </span>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">{data?.group.name ?? " "}</h1>
          {data?.implicit && (
            <p className="max-w-[620px] text-sm text-muted-foreground">
              Every active user is a member of All Users automatically.
            </p>
          )}
        </div>
        {data && !data.implicit && (
          <AddMemberDialog
            groupId={groupId}
            groupName={data.group.name}
            memberIds={new Set(data.items.map((m) => m.id))}
          />
        )}
      </header>

      {error && <ErrorBanner>{errorMessage(error)}</ErrorBanner>}

      <section className="rounded-md border border-border bg-card" aria-label="Members">
        {members.isPending && <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>}
        {data?.items.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">No members yet.</p>
        )}
        {data?.items.map((member) => (
          <div
            key={member.id}
            className="flex items-center gap-4 border-b border-border px-4 py-3 text-sm last:border-b-0"
          >
            <span className="w-48 truncate font-medium">
              {member.name}
              {member.id === me.user.id && (
                <span className="font-normal text-muted-foreground"> (you)</span>
              )}
            </span>
            <span className="flex-1 truncate text-muted-foreground">{member.email}</span>
            {!data.implicit && (
              <Button
                variant="ghost"
                size="sm"
                disabled={remove.isPending || (isAdmins && member.id === me.user.id)}
                onClick={() => remove.mutate(member.id)}
              >
                Remove
              </Button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

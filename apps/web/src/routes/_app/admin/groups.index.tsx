import { type Group, groupList } from "@jangka/shared/access";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { GroupNameDialog, type GroupNameTarget } from "@/components/admin/group-name-dialog";
import { ErrorBanner } from "@/components/error-banner";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/admin/groups/")({
  component: GroupsPage,
});

const groupsKey = ["admin", "groups"] as const;
const columns = "grid grid-cols-[minmax(0,1fr)_120px_120px_32px] gap-4";
const headerClass = "font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground";

function GroupsPage() {
  const queryClient = useQueryClient();
  const [nameTarget, setNameTarget] = useState<GroupNameTarget | null>(null);
  const [deleting, setDeleting] = useState<Group | null>(null);

  const groups = useQuery({
    queryKey: groupsKey,
    queryFn: () => apiFetch("/admin/groups", { schema: groupList }),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/admin/groups/${id}`, { method: "DELETE", schema: z.undefined() }),
    onSuccess: async () => {
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  return (
    <div className="flex flex-col gap-6 px-10 pt-7 pb-10">
      <header className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Admin</span>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Groups</h1>
          <p className="max-w-[620px] text-sm text-muted-foreground">
            Access is granted to groups, never to individual people. Everyone is in All Users;
            Administrators can manage everything.
          </p>
        </div>
        <Button size="sm" onClick={() => setNameTarget({ kind: "create" })}>
          New group
        </Button>
      </header>

      {groups.error && <ErrorBanner>{errorMessage(groups.error)}</ErrorBanner>}

      <section className="rounded-md border border-border bg-card" aria-label="Groups">
        <div className={cn(columns, headerClass, "border-b border-border px-4 py-2.5")}>
          <span>NAME</span>
          <span>MEMBERS</span>
          <span>TYPE</span>
          <span className="sr-only">Actions</span>
        </div>
        {groups.isPending && <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>}
        {groups.data?.items.map((group) => (
          <div
            key={group.id}
            className={cn(
              columns,
              "items-center border-b border-border px-4 py-3 text-sm last:border-b-0",
            )}
          >
            <Link
              to="/admin/groups/$groupId"
              params={{ groupId: group.id }}
              className="truncate font-medium hover:underline"
            >
              {group.name}
            </Link>
            <span className="text-muted-foreground">{group.memberCount}</span>
            <span className="text-muted-foreground">{group.systemKey ? "System" : "Custom"}</span>
            {group.systemKey ? (
              <span />
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary"
                  aria-label={`Actions for ${group.name}`}
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="text-[13px]">
                  <DropdownMenuItem
                    onSelect={() =>
                      setNameTarget({ kind: "rename", id: group.id, name: group.name })
                    }
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(group)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
      </section>

      <GroupNameDialog target={nameTarget} onClose={() => setNameTarget(null)} />

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              Its members lose any access granted through this group. This can't be undone.
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
              Delete group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

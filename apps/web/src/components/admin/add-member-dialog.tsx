import { adminUserList } from "@jangka/shared/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { z } from "zod";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";

type AddMemberDialogProps = {
  groupId: string;
  groupName: string;
  memberIds: ReadonlySet<string>;
};

export function AddMemberDialog({ groupId, groupName, memberIds }: AddMemberDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");

  // Admin users list is paginated; the first 200 covers a typical instance.
  const users = useQuery({
    queryKey: ["admin", "users", "picker"],
    queryFn: () => apiFetch("/admin/users?limit=200", { schema: adminUserList }),
    enabled: open,
  });

  const add = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/admin/groups/${groupId}/members`, {
        method: "POST",
        body: { userId: id },
        schema: z.undefined(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      onOpenChange(false);
    },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setUserId("");
      add.reset();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (userId) add.mutate(userId);
  }

  const candidates = (users.data?.items ?? []).filter((u) => u.isActive && !memberIds.has(u.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">Add member</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Add member to {groupName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {(add.error ?? users.error) && (
            <ErrorBanner>{errorMessage(add.error ?? users.error)}</ErrorBanner>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-user" className="text-[13px] font-medium">
              User
            </Label>
            <select
              id="member-user"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              className="h-[38px] rounded-sm border border-input bg-card px-2 text-sm"
            >
              <option value="" disabled>
                {users.isPending ? "Loading…" : "Select a user"}
              </option>
              {candidates.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} — {user.email}
                </option>
              ))}
            </select>
            {users.data && candidates.length === 0 && (
              <p className="text-xs text-muted-foreground">Everyone is already a member.</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!userId || add.isPending}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

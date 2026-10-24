import { type AccessView, accessCheck } from "@jangka/shared/access";
import { adminUserList } from "@jangka/shared/auth";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { childrenByParent, levelLabels, ROOT_NAME } from "@/lib/collections";
import { errorMessage } from "@/lib/form-errors";
import { cn } from "@/lib/utils";

function reasonText({ reason }: AccessView): string {
  switch (reason.kind) {
    case "admin":
      return "Administrator";
    case "owner":
      return "Owner";
    case "grant":
      return `via ${reason.groupName} on ${reason.collectionName}`;
    case "none":
      return "No grant";
  }
}

export function AccessCheckDialog() {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");

  const users = useQuery({
    queryKey: ["admin", "users", "picker"],
    queryFn: () => apiFetch("/admin/users?limit=200", { schema: adminUserList }),
    enabled: open,
  });
  const check = useQuery({
    queryKey: ["admin", "permissions", "check", userId],
    queryFn: () => apiFetch(`/admin/permissions/check?userId=${userId}`, { schema: accessCheck }),
    enabled: open && userId !== "",
  });

  const rows: { id: string; name: string; depth: number; access: AccessView }[] = [];
  if (check.data) {
    const byParent = childrenByParent(check.data.collections);
    rows.push({ id: "root", name: ROOT_NAME, depth: 0, access: check.data.root });
    const walk = (parentId: string | null, depth: number) => {
      for (const item of byParent.get(parentId) ?? []) {
        rows.push({ id: item.id, name: item.name, depth, access: item });
        walk(item.id, depth + 1);
      }
    };
    walk(null, 1);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setUserId("");
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Check a user's access
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Check a user's access</DialogTitle>
          <DialogDescription>
            Saved permissions only; staged changes aren't included.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="check-user" className="text-[13px] font-medium">
            User
          </Label>
          <select
            id="check-user"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            className="h-[38px] rounded-sm border border-input bg-card px-2 text-sm"
          >
            <option value="" disabled>
              {users.isPending ? "Loading…" : "Select a user"}
            </option>
            {users.data?.items.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} — {user.email}
              </option>
            ))}
          </select>
        </div>
        {(users.error ?? check.error) && (
          <ErrorBanner>{errorMessage(users.error ?? check.error)}</ErrorBanner>
        )}
        {rows.length > 0 && (
          <div className="max-h-80 overflow-auto rounded-sm border border-border text-[13px]">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <span
                  className={cn("flex-1 truncate", row.depth === 0 && "font-medium")}
                  style={{ paddingLeft: Math.max(0, row.depth - 1) * 16 }}
                >
                  {row.name}
                </span>
                <span
                  className={cn("w-20", row.access.level === "none" && "text-muted-foreground")}
                >
                  {levelLabels[row.access.level]}
                </span>
                <span className="w-48 truncate text-xs text-muted-foreground">
                  {reasonText(row.access)}
                </span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import type { AdminUser } from "@jangka/shared/auth";
import { inviteLinkResponse } from "@jangka/shared/auth";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
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
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { LinkResult } from "./link-result";

/** Opening the dialog issues the link (and expires any earlier unused one). */
export function ResetLinkDialog({
  user,
  onClose,
}: {
  user: AdminUser | null;
  onClose: () => void;
}) {
  const createLink = useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/admin/users/${userId}/reset-link`, { method: "POST", schema: inviteLinkResponse }),
  });
  const { mutate, reset } = createLink;
  // Each issued link expires the previous one, so request exactly once per opened user
  // (StrictMode runs effects twice in development).
  const requestedFor = useRef<string | null>(null);

  useEffect(() => {
    if (user && requestedFor.current !== user.id) {
      requestedFor.current = user.id;
      mutate(user.id);
    } else if (!user) {
      requestedFor.current = null;
      reset();
    }
  }, [user, mutate, reset]);

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Password reset link</DialogTitle>
          <DialogDescription>
            {user?.name} sets a new password with this link. Their current sessions end when they
            use it.
          </DialogDescription>
        </DialogHeader>
        {createLink.error && <ErrorBanner>{errorMessage(createLink.error)}</ErrorBanner>}
        {createLink.data && user && <LinkResult {...createLink.data} email={user.email} />}
        {createLink.isPending && (
          <p className="text-[13px] text-muted-foreground">Creating link…</p>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

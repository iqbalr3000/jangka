import { createInviteRequest, inviteLinkResponse } from "@jangka/shared/auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { LinkResult } from "./link-result";

export function InviteDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string>();

  const invite = useMutation({
    mutationFn: (input: { email: string }) =>
      apiFetch("/admin/invites", { method: "POST", body: input, schema: inviteLinkResponse }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "invites"] }),
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setEmail("");
      setFieldError(undefined);
      invite.reset();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = createInviteRequest.safeParse({ email });
    if (!parsed.success) return setFieldError(parsed.error.issues[0]?.message);
    setFieldError(undefined);
    invite.mutate(parsed.data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">Invite user</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>
            Creates a single-use sign-up link. Jangka doesn't send email — you share the link.
          </DialogDescription>
        </DialogHeader>
        {invite.data ? (
          <>
            <LinkResult {...invite.data} email={invite.variables?.email ?? email} />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            {invite.error && <ErrorBanner>{errorMessage(invite.error)}</ErrorBanner>}
            <FormField
              id="invite-email"
              label="Email"
              type="email"
              autoFocus
              placeholder="name@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={fieldError}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={invite.isPending}>
                Create link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

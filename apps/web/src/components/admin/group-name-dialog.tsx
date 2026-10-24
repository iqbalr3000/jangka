import { group } from "@jangka/shared/access";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { z } from "zod";
import { ErrorBanner } from "@/components/error-banner";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";

export type GroupNameTarget = { kind: "create" } | { kind: "rename"; id: string; name: string };

type GroupNameDialogProps = { target: GroupNameTarget | null; onClose: () => void };

export function GroupNameDialog({ target, onClose }: GroupNameDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const save = useMutation({
    mutationFn: async (input: { target: GroupNameTarget; name: string }) => {
      if (input.target.kind === "create") {
        await apiFetch("/admin/groups", {
          method: "POST",
          body: { name: input.name },
          schema: group,
        });
      } else {
        await apiFetch(`/admin/groups/${input.target.id}`, {
          method: "PATCH",
          body: { name: input.name },
          schema: z.undefined(),
        });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "groups"] });
      onClose();
    },
  });

  const { reset } = save;
  useEffect(() => {
    setName(target?.kind === "rename" ? target.name : "");
    reset();
  }, [target, reset]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!target || name.trim() === "") return;
    save.mutate({ target, name: name.trim() });
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{target?.kind === "rename" ? "Rename group" : "New group"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {save.error && <ErrorBanner>{errorMessage(save.error)}</ErrorBanner>}
          <FormField
            id="group-name"
            label="Name"
            autoFocus
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || name.trim() === ""}>
              {target?.kind === "rename" ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

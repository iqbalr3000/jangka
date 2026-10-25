import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  /** Omitted: a message with only a Close button. */
  onConfirm?: () => void;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onClose: () => void;
};

/** In-app replacement for window.confirm / window.alert. */
export function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  confirmLabel = "Confirm",
  destructive = false,
  pending = false,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant={onConfirm ? "ghost" : "outline"} onClick={onClose}>
            {onConfirm ? "Cancel" : "Close"}
          </Button>
          {onConfirm && (
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

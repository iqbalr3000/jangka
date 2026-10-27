import type { docTypeSchema } from "@jangka/shared/document";
import { type TemplateFamily, templateDetail } from "@jangka/shared/templates";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import type { z } from "zod";
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
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { docTypeLabels } from "@/lib/trace";
import { cn } from "@/lib/utils";

type DocType = z.infer<typeof docTypeSchema>;

const TYPES: { value: DocType; name: string }[] = [
  { value: "brd", name: "Business Requirements" },
  { value: "prd", name: "Product Requirements" },
  { value: "tsd", name: "Technical Specification" },
];
const BLANK = "";

export function NewTemplateDialog({
  open,
  families,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  families: TemplateFamily[];
  onOpenChange: (open: boolean) => void;
  onCreated: (templateId: string) => Promise<void>;
}) {
  const [docType, setDocType] = useState<DocType>("prd");
  const [name, setName] = useState("");
  const [sourceId, setSourceId] = useState(BLANK);

  const sources = families.flatMap((family) => {
    const latest = family.versions.find((v) => v.published);
    return family.docType === docType && !family.archived && latest
      ? [
          {
            id: latest.id,
            label: `${family.name} · v${latest.version} · ${latest.sectionCount} section${latest.sectionCount === 1 ? "" : "s"}`,
          },
        ]
      : [];
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch("/admin/templates", {
        method: "POST",
        body: { docType, name: name.trim(), ...(sourceId ? { sourceId } : {}) },
        schema: templateDetail,
      }),
    onSuccess: (draft) => onCreated(draft.id),
  });

  function changeOpen(next: boolean) {
    if (!next) {
      setDocType("prd");
      setName("");
      setSourceId(BLANK);
      create.reset();
    }
    onOpenChange(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
          <DialogDescription>It starts as a draft you can edit and publish.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {create.error && <ErrorBanner>{errorMessage(create.error)}</ErrorBanner>}
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium" id="new-template-type-label">
              Type
            </span>
            <div
              className="grid grid-cols-3 gap-2 text-[13px]"
              role="radiogroup"
              aria-labelledby="new-template-type-label"
            >
              {TYPES.map((type) => (
                <label
                  key={type.value}
                  className={cn(
                    "flex cursor-pointer flex-col items-start rounded-sm border px-3 py-1.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
                    docType === type.value
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary",
                  )}
                >
                  <input
                    type="radio"
                    name="new-template-type"
                    value={type.value}
                    checked={docType === type.value}
                    onChange={() => {
                      setDocType(type.value);
                      setSourceId(BLANK);
                    }}
                    className="sr-only"
                  />
                  <span className="font-mono text-[11px] font-medium">
                    {docTypeLabels[type.value]}
                  </span>
                  <span className="text-xs">{type.name}</span>
                </label>
              ))}
            </div>
          </div>
          <FormField
            id="new-template-name"
            label="Name"
            autoFocus
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-template-source" className="text-[13px] font-medium">
              Start from
            </Label>
            <select
              id="new-template-source"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              className="h-[38px] rounded-sm border border-input bg-card px-2 text-sm"
            >
              <option value={BLANK}>Blank — no sections</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => changeOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

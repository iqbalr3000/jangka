import { type TemplateFamily, templateDetail } from "@jangka/shared/templates";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { type FormEvent, useState } from "react";
import { z } from "zod";
import { ErrorBanner } from "@/components/error-banner";
import { FormField } from "@/components/form-field";
import { LoadingRows } from "@/components/loading-rows";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { templateFamiliesQuery, templatesKey } from "@/lib/templates";
import { docTypeLabels } from "@/lib/trace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/admin/templates/")({
  component: TemplatesPage,
});

const TYPES = ["brd", "prd", "tsd"] as const;

function latestPublishedId(family: TemplateFamily): string | undefined {
  return family.versions.find((v) => v.published)?.id;
}

function TemplatesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const families = useQuery(templateFamiliesQuery);
  const [duplicating, setDuplicating] = useState<TemplateFamily | null>(null);
  const [name, setName] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: templatesKey });
  const openEditor = (templateId: string) =>
    navigate({ to: "/admin/templates/$templateId", params: { templateId } });

  const duplicate = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      apiFetch(`/admin/templates/${input.id}/duplicate`, {
        method: "POST",
        body: { name: input.name },
        schema: templateDetail,
      }),
    onSuccess: async (draft) => {
      setDuplicating(null);
      await invalidate();
      await openEditor(draft.id);
    },
  });

  const action = useMutation({
    mutationFn: async (input: {
      kind: "new-version" | "archive" | "restore" | "default";
      family: TemplateFamily;
      id: string;
    }) => {
      if (input.kind === "new-version") {
        return apiFetch(`/admin/templates/${input.id}/new-version`, {
          method: "POST",
          schema: templateDetail,
        });
      }
      if (input.kind === "default") {
        return apiFetch("/admin/settings/templates", {
          method: "PUT",
          body: { docType: input.family.docType, name: input.family.name },
          schema: z.undefined(),
        });
      }
      return apiFetch(`/admin/templates/${input.id}/${input.kind}`, {
        method: "POST",
        schema: z.undefined(),
      });
    },
    onSuccess: async (result) => {
      await invalidate();
      if (result) await openEditor(result.id);
    },
  });

  function submitDuplicate(event: FormEvent) {
    event.preventDefault();
    const id = duplicating && latestPublishedId(duplicating);
    if (id && name.trim()) duplicate.mutate({ id, name: name.trim() });
  }

  const items = families.data?.items ?? [];
  const error = families.error ?? action.error;

  return (
    <div className="flex flex-col gap-6 px-10 pt-7 pb-10">
      <header className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Admin</span>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Templates</h1>
        <p className="max-w-[620px] text-sm text-muted-foreground">
          Duplicate a built-in template to adapt its sections and guidance. Published versions never
          change; documents keep the version they were created with.
        </p>
      </header>

      {error && <ErrorBanner>{errorMessage(error)}</ErrorBanner>}
      {families.isPending && <LoadingRows />}

      {TYPES.map((type) => {
        const ofType = items.filter((f) => f.docType === type);
        if (ofType.length === 0) return null;
        return (
          <section
            key={type}
            aria-label={`${docTypeLabels[type]} templates`}
            className="flex flex-col gap-2.5"
          >
            <span className="font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground">
              {docTypeLabels[type]}
            </span>
            <ul className="rounded-md border border-border bg-card">
              {ofType.map((family) => {
                const published = latestPublishedId(family);
                const latest = family.versions.find((v) => v.published);
                const documentCount = family.versions.reduce((n, v) => n + v.documentCount, 0);
                return (
                  <li
                    key={family.name}
                    aria-label={family.name}
                    className={cn(
                      "flex items-center gap-4 border-b border-border px-4 py-3 text-sm last:border-b-0",
                      family.archived && "text-muted-foreground",
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-2 font-medium">
                        {published ? (
                          <Link
                            to="/admin/templates/$templateId"
                            params={{ templateId: published }}
                            className="hover:underline"
                          >
                            {family.name}
                          </Link>
                        ) : (
                          family.name
                        )}
                        {family.isBuiltin && <Badge>Built-in</Badge>}
                        {family.isDefault && <Badge tone="primary">Default</Badge>}
                        {family.archived && <Badge>Archived</Badge>}
                        {family.draftId && <Badge tone="partial">Draft</Badge>}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {latest ? `v${latest.version}` : "Not published yet"} · {documentCount}{" "}
                        document{documentCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    {family.draftId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => family.draftId && void openEditor(family.draftId)}
                      >
                        Edit draft
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary"
                        aria-label={`Actions for ${family.name}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="text-[13px]">
                        <DropdownMenuItem
                          disabled={!published}
                          onSelect={() => {
                            setName(`${family.name} (copy)`);
                            setDuplicating(family);
                          }}
                        >
                          Duplicate…
                        </DropdownMenuItem>
                        {!family.isBuiltin && (
                          <DropdownMenuItem
                            disabled={!published || family.draftId !== null}
                            onSelect={() =>
                              published &&
                              action.mutate({ kind: "new-version", family, id: published })
                            }
                          >
                            New version
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          disabled={!published || family.isDefault || family.archived}
                          onSelect={() =>
                            published && action.mutate({ kind: "default", family, id: published })
                          }
                        >
                          Set as default
                        </DropdownMenuItem>
                        {!family.isBuiltin && published && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() =>
                                action.mutate({
                                  kind: family.archived ? "restore" : "archive",
                                  family,
                                  id: published,
                                })
                              }
                            >
                              {family.archived ? "Restore" : "Archive"}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <Dialog open={duplicating !== null} onOpenChange={(open) => !open && setDuplicating(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Duplicate “{duplicating?.name}”</DialogTitle>
            <DialogDescription>
              The copy starts as a draft you can edit and publish.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitDuplicate} className="flex flex-col gap-4">
            {duplicate.error && <ErrorBanner>{errorMessage(duplicate.error)}</ErrorBanner>}
            <FormField
              id="template-name"
              label="Name"
              autoFocus
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDuplicating(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={duplicate.isPending || !name.trim()}>
                Duplicate
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Badge({
  children,
  tone = "muted",
}: {
  children: string;
  tone?: "muted" | "primary" | "partial";
}) {
  return (
    <span
      className={cn(
        "rounded-sm border px-1.5 font-mono text-[11px] font-normal",
        tone === "primary" && "border-primary text-primary",
        tone === "partial" && "border-status-partial text-status-partial",
        tone === "muted" && "border-border text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

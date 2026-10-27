import { type DraftSection, type TemplateDetail, templateDetail } from "@jangka/shared/templates";
import { REQUIREMENT_KINDS_BY_TYPE } from "@jangka/templates";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { TemplateSectionCard } from "@/components/admin/template-section-card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorBanner } from "@/components/error-banner";
import { FormField } from "@/components/form-field";
import { PageSkeleton } from "@/components/page-skeleton";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { sectionErrors } from "@/lib/template-errors";
import { templateDetailQuery, templatesKey } from "@/lib/templates";
import { docTypeLabels } from "@/lib/trace";

export const Route = createFileRoute("/_app/admin/templates/$templateId")({
  component: TemplateEditorRoute,
});

type EditableSection = DraftSection & { uid: string };

function TemplateEditorRoute() {
  const { templateId } = Route.useParams();
  const detail = useQuery(templateDetailQuery(templateId));
  if (detail.isPending) return <PageSkeleton />;
  if (detail.error) {
    return (
      <div className="p-10">
        <ErrorBanner>{errorMessage(detail.error)}</ErrorBanner>
      </div>
    );
  }
  return <TemplateEditor key={detail.data.id} template={detail.data} />;
}

function TemplateEditor({ template }: { template: TemplateDetail }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const readOnly = template.published;
  const toEditable = (sections: DraftSection[]) =>
    sections.map((section) => ({ ...section, uid: section.key ?? crypto.randomUUID() }));
  const [name, setName] = useState(template.name);
  const [sections, setSections] = useState<EditableSection[]>(() => toEditable(template.sections));
  const [saved, setSaved] = useState(() => JSON.stringify([template.name, template.sections]));
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // The section just added: its title gets focus.
  const [focusUid, setFocusUid] = useState<string | null>(null);

  const payload = () => ({
    ...(template.familyPublished ? {} : { name: name.trim() }),
    sections: sections.map(({ uid: _uid, ...section }) => ({
      ...section,
      interviewHints: section.interviewHints.map((h) => h.trim()).filter(Boolean),
    })),
  });
  const dirty =
    !readOnly && JSON.stringify([name, sections.map(({ uid: _uid, ...s }) => s)]) !== saved;

  // Set before navigating away on purpose (discard), when state can't re-render in time.
  const leaving = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !leaving.current,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  const [discarding, setDiscarding] = useState(false);

  const afterSave = async (next: TemplateDetail) => {
    queryClient.setQueryData(templateDetailQuery(next.id).queryKey, next);
    // Same order as sent: keep each card's uid so open cards stay open.
    setSections((current) =>
      next.sections.map((section, i) => ({
        ...section,
        uid: current[i]?.uid ?? section.key,
      })),
    );
    setName(next.name);
    setSaved(JSON.stringify([next.name, next.sections]));
    await queryClient.invalidateQueries({ queryKey: [...templatesKey, "admin"], exact: true });
  };

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/templates/${template.id}`, {
        method: "PUT",
        body: payload(),
        schema: templateDetail,
      }),
    onSuccess: afterSave,
  });

  const publish = useMutation({
    mutationFn: async () => {
      const draft = await apiFetch(`/admin/templates/${template.id}`, {
        method: "PUT",
        body: payload(),
        schema: templateDetail,
      });
      await afterSave(draft);
      return apiFetch(`/admin/templates/${template.id}/publish`, {
        method: "POST",
        schema: templateDetail,
      });
    },
    onSuccess: async (published) => {
      await afterSave(published);
      await queryClient.invalidateQueries({ queryKey: templatesKey });
    },
    onError: (failure) => {
      const failing = Object.keys(sectionErrors(failure)).map(Number);
      if (failing.length === 0) return;
      setOpen((current) => {
        const next = new Set(current);
        for (const index of failing) {
          const uid = sections[index]?.uid;
          if (uid) next.add(uid);
        }
        return next;
      });
    },
  });

  const discard = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/templates/${template.id}`, { method: "DELETE", schema: z.undefined() }),
    onSuccess: async () => {
      leaving.current = true;
      await queryClient.invalidateQueries({ queryKey: templatesKey });
      await navigate({ to: "/admin/templates" });
    },
  });

  // A published draft becomes read-only: the saved state is the truth.
  useEffect(() => {
    if (template.published) setSaved(JSON.stringify([template.name, template.sections]));
  }, [template]);

  const error = save.error ?? publish.error ?? discard.error;
  const errorsBySection = sectionErrors(error);
  const update = (index: number, section: DraftSection) =>
    setSections((list) => list.map((s, i) => (i === index ? { ...s, ...section } : s)));
  const insertAt = (index: number) => {
    const uid = crypto.randomUUID();
    setSections((list) => [
      ...list.slice(0, index),
      { uid, title: "New section", required: false, guidance: "", interviewHints: [] },
      ...list.slice(index),
    ]);
    setOpen((current) => new Set(current).add(uid));
    setFocusUid(uid);
  };
  const toggle = (uid: string) =>
    setOpen((current) => {
      if (!current.has(uid)) return new Set([uid]);
      const next = new Set(current);
      next.delete(uid);
      return next;
    });
  const allOpen = sections.length > 0 && sections.every((s) => open.has(s.uid));

  // ⌘S / Ctrl+S saves the draft instead of the browser's "Save page".
  const saveRef = useRef(() => {});
  saveRef.current = () => {
    if (dirty && !save.isPending) save.mutate();
  };
  useEffect(() => {
    if (readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly]);

  const move = (index: number, delta: -1 | 1) =>
    setSections((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      if (item) next.splice(index + delta, 0, item);
      return next;
    });

  return (
    <div className="flex flex-col gap-6 px-10 pb-10">
      <header className="sticky top-0 z-10 -mx-10 flex items-end gap-3 border-b border-border bg-background px-10 pt-7 pb-4">
        <div className="flex flex-1 flex-col gap-1.5">
          <Link
            to="/admin/templates"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" aria-hidden /> Templates
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-[-0.02em]">
            <span className="rounded-[3px] border border-border-strong px-1.5 font-mono text-xs font-medium">
              {docTypeLabels[template.docType]}
            </span>
            {template.name}
            <span className="text-base font-normal text-muted-foreground">
              v{template.version} · {readOnly ? "Published" : "Draft"}
            </span>
          </h1>
        </div>
        {!readOnly && (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={discard.isPending}
              onClick={() => setDiscarding(true)}
            >
              Discard draft
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={save.isPending || !dirty}
              title="Save draft (⌘S)"
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : dirty ? "Save draft" : "Saved"}
            </Button>
            <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate()}>
              Publish v{template.version}
            </Button>
          </>
        )}
      </header>

      {readOnly && (
        <p className="rounded-sm bg-secondary px-3 py-2 text-sm text-muted-foreground">
          Published versions can't change. Use “New version” or “Duplicate…” on the Templates page.
        </p>
      )}
      {error && <ErrorBanner>{errorMessage(error)}</ErrorBanner>}
      {!readOnly &&
        sections.length > 0 &&
        REQUIREMENT_KINDS_BY_TYPE[template.docType].length > 0 &&
        !sections.some((s) => s.requirementKind) && (
          <p className="text-sm text-muted-foreground">
            No section collects requirements, so documents from this template won't have requirement
            IDs or trace links.
          </p>
        )}

      {!readOnly && !template.familyPublished && (
        <div className="max-w-md">
          <FormField
            id="template-name"
            label="Template name"
            hint="Fixed once the first version is published."
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      )}

      <section aria-label="Sections" className="flex flex-col">
        {sections.length > 0 && (
          <div className="flex h-7 items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {sections.length} section{sections.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() => setOpen(allOpen ? new Set() : new Set(sections.map((s) => s.uid)))}
              className="rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          </div>
        )}
        {sections.length === 0 && (
          <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No sections yet. Add the first section to define the document.
          </p>
        )}
        {sections.map((section, index) => (
          <div key={section.uid} className="flex flex-col">
            {readOnly ? (
              <div className="h-2" />
            ) : (
              <InsertSection position={index + 1} onInsert={() => insertAt(index)} />
            )}
            <TemplateSectionCard
              index={index}
              count={sections.length}
              docType={template.docType}
              section={section}
              readOnly={readOnly}
              expanded={open.has(section.uid)}
              autoFocus={focusUid === section.uid}
              errors={errorsBySection[index] ?? {}}
              onToggle={() => toggle(section.uid)}
              onChange={(next) => update(index, next)}
              onMove={(delta) => move(index, delta)}
              onRemove={() => setSections((list) => list.filter((_, i) => i !== index))}
            />
          </div>
        ))}
        {!readOnly && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 self-start"
            onClick={() => insertAt(sections.length)}
          >
            + Add section
          </Button>
        )}
      </section>

      <ConfirmDialog
        open={blocker.status === "blocked"}
        title="Leave without saving?"
        description="Changes to this draft since the last save will be lost."
        confirmLabel="Leave"
        destructive
        onConfirm={() => blocker.proceed?.()}
        onClose={() => blocker.reset?.()}
      />
      <ConfirmDialog
        open={discarding}
        title="Discard this draft?"
        description="The draft is deleted. Published versions aren't affected."
        confirmLabel="Discard draft"
        destructive
        pending={discard.isPending}
        onConfirm={() => discard.mutate()}
        onClose={() => setDiscarding(false)}
      />
    </div>
  );
}

/** A thin gap between cards that reveals "Insert section" on hover or keyboard focus. */
function InsertSection({ position, onInsert }: { position: number; onInsert: () => void }) {
  return (
    <div className="group relative flex h-3 items-center">
      <div className="h-px w-full bg-transparent group-hover:bg-border" />
      <button
        type="button"
        aria-label={`Insert section at position ${position}`}
        onClick={onInsert}
        className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-sm border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground opacity-0 shadow-float group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
      >
        <Plus className="size-3" aria-hidden /> Insert section
      </button>
    </div>
  );
}

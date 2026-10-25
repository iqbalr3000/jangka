import { type DraftSection, type TemplateDetail, templateDetail } from "@jangka/shared/templates";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { TemplateSectionCard } from "@/components/admin/template-section-card";
import { ErrorBanner } from "@/components/error-banner";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { templateDetailQuery, templatesKey } from "@/lib/templates";
import { docTypeLabels } from "@/lib/trace";

export const Route = createFileRoute("/_app/admin/templates/$templateId")({
  component: TemplateEditorRoute,
});

type EditableSection = DraftSection & { uid: string };

const issueList = z.array(
  z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }),
);

/** `sections.3.requirementKind` style API issues → per-section field messages. */
function sectionErrors(error: unknown): Record<number, Record<string, string>> {
  if (!(error instanceof ApiError)) return {};
  const parsed = issueList.safeParse(error.details);
  if (!parsed.success) return {};
  const out: Record<number, Record<string, string>> = {};
  for (const { path, message } of parsed.data) {
    const [root, index, field] = path;
    if (root !== "sections" || typeof index !== "number") continue;
    out[index] = { ...out[index], [String(field ?? "title")]: message };
  }
  return out;
}

function TemplateEditorRoute() {
  const { templateId } = Route.useParams();
  const detail = useQuery(templateDetailQuery(templateId));
  if (detail.isPending) return <p className="px-10 pt-7 text-sm text-muted-foreground">Loading…</p>;
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
  useBlocker({
    shouldBlockFn: () =>
      dirty && !leaving.current && !window.confirm("Leave without saving the draft?"),
    enableBeforeUnload: () => dirty,
  });

  const afterSave = async (next: TemplateDetail) => {
    queryClient.setQueryData(templateDetailQuery(next.id).queryKey, next);
    setSections(toEditable(next.sections));
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
  const move = (index: number, delta: -1 | 1) =>
    setSections((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      if (item) next.splice(index + delta, 0, item);
      return next;
    });

  return (
    <div className="flex flex-col gap-6 px-10 pt-7 pb-10">
      <header className="flex items-end gap-3">
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
              onClick={() => window.confirm("Discard this draft?") && discard.mutate()}
            >
              Discard draft
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={save.isPending || !dirty}
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

      <section aria-label="Sections" className="flex flex-col gap-3">
        {sections.map((section, index) => (
          <TemplateSectionCard
            key={section.uid}
            index={index}
            count={sections.length}
            docType={template.docType}
            section={section}
            readOnly={readOnly}
            errors={errorsBySection[index] ?? {}}
            onChange={(next) => update(index, next)}
            onMove={(delta) => move(index, delta)}
            onRemove={() => setSections((list) => list.filter((_, i) => i !== index))}
          />
        ))}
        {!readOnly && (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              setSections((list) => [
                ...list,
                {
                  uid: crypto.randomUUID(),
                  title: "New section",
                  required: false,
                  guidance: "Describe what this section should contain.",
                  interviewHints: [],
                },
              ])
            }
          >
            + Add section
          </Button>
        )}
      </section>
    </div>
  );
}

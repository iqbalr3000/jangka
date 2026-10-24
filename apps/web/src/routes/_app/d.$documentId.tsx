import type { DocumentDetail, Section } from "@jangka/shared/document";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { DocumentHeader, type SaveSummary } from "@/components/documents/document-header";
import { type SaveState, SectionEditor } from "@/components/documents/section-editor";
import { SectionOutline } from "@/components/documents/section-outline";
import { SectionStatusIcon } from "@/components/documents/section-status-icon";
import { ErrorBanner } from "@/components/error-banner";
import { ApiError } from "@/lib/api";
import { documentQuery, sectionAnchor } from "@/lib/documents";
import { errorMessage } from "@/lib/form-errors";

export const Route = createFileRoute("/_app/d/$documentId")({
  component: DocumentRoute,
});

function DocumentRoute() {
  const { documentId } = Route.useParams();
  const { me } = Route.useRouteContext();
  const detail = useQuery(documentQuery(documentId));

  if (detail.isPending) {
    return <p className="px-10 pt-7 text-sm text-muted-foreground">Loading…</p>;
  }
  if (detail.error) {
    if (detail.error instanceof ApiError && detail.error.status === 404) {
      return (
        <div className="blueprint-grid flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-base font-medium">Document not found.</p>
          <p className="text-sm text-muted-foreground">
            It doesn't exist or you don't have access to it.
          </p>
          <Link to="/" className="text-sm text-primary hover:underline">
            Back to home
          </Link>
        </div>
      );
    }
    return (
      <div className="p-10">
        <ErrorBanner>{errorMessage(detail.error)}</ErrorBanner>
      </div>
    );
  }
  // Keyed so editors are recreated (fresh content + revision) when switching documents.
  return <DocumentWorkspace key={documentId} detail={detail.data} userId={me.user.id} />;
}

function DocumentWorkspace({ detail, userId }: { detail: DocumentDetail; userId: string }) {
  const queryClient = useQueryClient();
  const { document: doc } = detail;
  const editable = detail.level === "edit";
  const states = useRef(new Map<string, SaveState>());
  const [save, setSave] = useState<SaveSummary>({ state: "idle", at: null });

  const onSaveState = useCallback((key: string, state: SaveState) => {
    states.current.set(key, state);
    const all = [...states.current.values()];
    const overall: SaveState = all.includes("conflict")
      ? "conflict"
      : all.includes("error")
        ? "error"
        : all.includes("saving")
          ? "saving"
          : "saved";
    setSave((current) => ({
      state: overall,
      at: overall === "saved" ? new Date().toISOString() : current.at,
    }));
  }, []);

  // Keep outline/completeness live without re-seeding the editors (they own their content).
  const onSaved = useCallback(
    (saved: Section) => {
      queryClient.setQueryData(documentQuery(doc.id).queryKey, (current) =>
        current
          ? {
              ...current,
              sections: current.sections.map((s) => (s.key === saved.key ? saved : s)),
            }
          : current,
      );
    },
    [queryClient, doc.id],
  );

  return (
    <div className="flex h-full flex-col">
      <DocumentHeader detail={detail} userId={userId} save={save} />
      {!editable && (
        <div className="border-b border-border bg-secondary px-4 py-2 text-[13px] text-muted-foreground">
          You have view access.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <SectionOutline sections={detail.sections} />
        <main className="min-w-0 flex-1 overflow-auto">
          <article className="mx-auto flex max-w-[72ch] flex-col gap-10 px-6 py-10">
            <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em]">
              {doc.title}
            </h1>
            {detail.sections.map((section) => (
              <section
                key={section.key}
                id={sectionAnchor(section.key)}
                aria-labelledby={`${sectionAnchor(section.key)}-title`}
                className="flex scroll-mt-6 flex-col gap-3"
              >
                <div className="flex items-center gap-3">
                  <h2
                    id={`${sectionAnchor(section.key)}-title`}
                    className="text-xl font-semibold tracking-[-0.01em]"
                  >
                    {section.title}
                  </h2>
                  <SectionStatusIcon completeness={section.completeness} withLabel />
                </div>
                <SectionEditor
                  documentId={doc.id}
                  section={section}
                  editable={editable}
                  onSaved={onSaved}
                  onSaveState={onSaveState}
                />
              </section>
            ))}
          </article>
        </main>
      </div>
    </div>
  );
}

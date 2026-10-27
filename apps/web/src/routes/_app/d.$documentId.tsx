import { fromMarkdown } from "@jangka/export";
import type { InterviewState } from "@jangka/shared/assistant";
import {
  type DocNode,
  type DocumentDetail,
  type Section,
  section as sectionSchema,
} from "@jangka/shared/document";
import type { ExportJob } from "@jangka/shared/export";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantPanel, type PanelTab, panelTabs } from "@/components/assistant/assistant-panel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DocumentHeader, type SaveSummary } from "@/components/documents/document-header";
import { DocumentSkeleton } from "@/components/documents/document-skeleton";
import { ExportDialog } from "@/components/documents/export-dialog";
import { ExportToast } from "@/components/documents/export-toast";
import { SectionBlock } from "@/components/documents/section-block";
import type { SaveState } from "@/components/documents/section-editor";
import { SectionOutline } from "@/components/documents/section-outline";
import { TemplateUpgradeBanner } from "@/components/documents/template-upgrade-banner";
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
import { ApiError, apiFetch } from "@/lib/api";
import { chatQuery } from "@/lib/assistant";
import { applySavedSection, documentQuery, sectionAnchor } from "@/lib/documents";
import { createExport } from "@/lib/exports";
import { errorMessage } from "@/lib/form-errors";
import { isPlainKey } from "@/lib/keyboard";
import { llmStatusQuery, timeAgo } from "@/lib/llm";
import { usePersistentState } from "@/lib/persistent-state";
import { commentsQuery } from "@/lib/review";
import { traceQuery } from "@/lib/trace";
import { type Assistant, useAssistant } from "@/lib/use-assistant";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/d/$documentId")({
  component: DocumentRoute,
});

function DocumentRoute() {
  const { documentId } = Route.useParams();
  const { me } = Route.useRouteContext();
  const detail = useQuery(documentQuery(documentId));

  if (detail.isPending) {
    return <DocumentSkeleton />;
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

/** Below 1024 px one pane shows at a time. */
const panes = ["document", "assistant", "outline"] as const;
type Pane = (typeof panes)[number];

type DraftConfirm = { targets: string[]; sections?: string[]; message: string };

function DocumentWorkspace({ detail, userId }: { detail: DocumentDetail; userId: string }) {
  const queryClient = useQueryClient();
  const { me } = Route.useRouteContext();
  const { document: doc } = detail;
  // Approved documents are frozen until reopened.
  const approved = doc.status === "approved";
  const editable = detail.level === "edit" && !approved;
  const states = useRef(new Map<string, SaveState>());
  const [save, setSave] = useState<SaveSummary>({ state: "idle", at: null });
  const [seeds, setSeeds] = useState<Record<string, DocNode>>({});
  const [accepted, setAccepted] = useState<Record<string, DocNode>>({});
  const [composer, setComposer] = useState("");
  const [confirm, setConfirm] = useState<DraftConfirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [panel, setPanel] = usePersistentState("jangka.assistant", ["open", "closed"], "open");
  const [panelTab, setPanelTab] = usePersistentState("jangka.panel-tab", panelTabs, "chat");
  const [outline, setOutline] = usePersistentState("jangka.outline", ["open", "closed"], "open");
  const [pane, setPane] = useState<Pane>("document");
  const mainRef = useRef<HTMLElement>(null);
  const [historyKey, setHistoryKey] = useState(detail.sections[0]?.key ?? "");
  const [commentsSection, setCommentsSection] = useState("");
  const openComments = useQuery(commentsQuery(doc.id, "open")).data?.openCountBySection ?? {};
  const trace = useQuery(traceQuery(doc.id));
  const hasRequirements = (trace.data?.requirements.length ?? 0) > 0;
  const canDraftFromSource = detail.source !== null && !("restricted" in detail.source);
  const llmStatus = useQuery(llmStatusQuery);
  const chat = useQuery(chatQuery(doc.id));
  const llmConfigured = llmStatus.data?.configured ?? false;

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

  const onSaved = useCallback(
    (saved: Section) => applySavedSection(queryClient, doc.id, saved),
    [queryClient, doc.id],
  );

  const assistant = useAssistant(doc.id);
  const { replaceSection, generations } = assistant;
  const running = assistant.running !== null;
  // Drafting reads the coverage the last chat turn is still assessing.
  const canGenerate = editable && llmConfigured && !running && !assistant.coverageUpdating;

  const pendingDraft = new Set(
    assistant.draft
      ? assistant.draft.targets.filter((key) => !assistant.draft?.finished.includes(key))
      : [],
  );
  const outlineLabels = Object.fromEntries(
    [...pendingDraft].map((key) => [key, key === assistant.draft?.current ? "Drafting" : "Queued"]),
  );

  const showSection = useCallback((key: string) => {
    setPane("document");
    requestAnimationFrame(() =>
      document
        .getElementById(sectionAnchor(key))
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, []);

  /** `[` / `]`: the section above / below the one at the top of the view. */
  const stepSection = useCallback(
    (step: 1 | -1) => {
      const top = mainRef.current?.getBoundingClientRect().top ?? 0;
      const offsets = detail.sections.map(
        (s) =>
          (document.getElementById(sectionAnchor(s.key))?.getBoundingClientRect().top ?? 0) - top,
      );
      // A few px of slack: a section scrolled to the top sits at about 0.
      const current = offsets.findLastIndex((offset) => offset <= 8);
      // Back from the middle of a section goes to its start first.
      const midway = current >= 0 && (offsets[current] ?? 0) < -8;
      const target = step === -1 && midway ? current : current + step;
      const section = detail.sections[Math.min(Math.max(target, 0), detail.sections.length - 1)];
      if (section) showSection(section.key);
    },
    [detail.sections, showSection],
  );

  // Esc stops, ⌘. / ⌘\ toggle the assistant panel / outline, ⌘⇧E exports, [ ] move between sections.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && running) assistant.stop();
      if (event.key === "." && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPanel(panel === "open" ? "closed" : "open");
      }
      if (event.key === "\\" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOutline(outline === "open" ? "closed" : "open");
      }
      if (isPlainKey(event, "[") || isPlainKey(event, "]")) {
        event.preventDefault();
        stepSection(event.key === "]" ? 1 : -1);
      }
      if (event.key.toLowerCase() === "e" && event.shiftKey && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setExporting(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [running, assistant.stop, panel, setPanel, outline, setOutline, stepSection]);

  function showPanel(tab?: PanelTab) {
    if (tab) setPanelTab(tab);
    setPanel("open");
    setPane("assistant");
  }

  function coverageOf(key: string) {
    return chat.data?.state?.sections.find((s) => s.key === key)?.coverage ?? "missing";
  }

  const emptyKeys = detail.sections.filter((s) => s.completeness === "empty").map((s) => s.key);

  function draftAll() {
    const missing = detail.sections.filter(
      (s) => s.required && emptyKeys.includes(s.key) && coverageOf(s.key) === "missing",
    );
    if (missing.length > 0) {
      setConfirm({
        targets: emptyKeys,
        message: `${missing.length} required section${missing.length === 1 ? "" : "s"} lack information and will stay empty.`,
      });
    } else {
      assistant.draftSections({ targets: emptyKeys });
    }
  }

  function draftOne(section: Section) {
    if (section.completeness === "empty") {
      assistant.draftSections({ sections: [section.key], force: true, targets: [section.key] });
    } else {
      setConfirm({
        targets: [section.key],
        sections: [section.key],
        message: `Redrafting replaces the current “${section.title}”. The current text stays in the history.`,
      });
    }
  }

  async function put(section: Section, content: DocNode, source: "human" | "llm") {
    setBusy(true);
    try {
      const saved = await apiFetch(`/documents/${doc.id}/sections/${section.key}`, {
        method: "PUT",
        body: { content, revision: section.revision, source },
        schema: sectionSchema,
      });
      replaceSection(saved);
      return true;
    } catch (error) {
      setProblem({ title: "Couldn't save the section", message: errorMessage(error) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function accept(section: Section) {
    const proposal = assistant.proposals[section.key];
    if (!proposal) return;
    const previous = section.content;
    if (await put(section, fromMarkdown(proposal.markdown), "llm")) {
      assistant.clearProposal(section.key);
      setAccepted((a) => ({ ...a, [section.key]: previous }));
    }
  }

  async function undo(section: Section) {
    const previous = accepted[section.key];
    if (previous && (await put(section, previous, "human"))) {
      setAccepted(({ [section.key]: _undone, ...rest }) => rest);
    }
  }

  function editBeforeAccepting(section: Section) {
    const proposal = assistant.proposals[section.key];
    if (!proposal) return;
    setSeeds((s) => ({ ...s, [section.key]: fromMarkdown(proposal.markdown) }));
    assistant.remountSection(section.key);
    assistant.clearProposal(section.key);
  }

  function revise(key: string, instruction: string) {
    setAccepted(({ [key]: _replaced, ...rest }) => rest);
    assistant.revise(key, instruction);
    showSection(key);
  }

  function reviewUpdates(suggestions: InterviewState["suggestions"]) {
    const keys = new Set(suggestions.map((s) => s.key));
    setAccepted((a) => Object.fromEntries(Object.entries(a).filter(([key]) => !keys.has(key))));
    assistant.proposeUpdates(suggestions);
    const first = detail.sections.find((s) => keys.has(s.key));
    if (first) showSection(first.key);
  }

  function askAbout(section: Section) {
    showPanel("chat");
    setComposer(`About ${section.title}: `);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Message the assistant"]',
      );
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  }

  async function retryExport(job: ExportJob) {
    try {
      setExportJob(
        await createExport(doc.id, {
          format: job.format,
          includeCover: job.includeCover,
          includeAppendix: job.includeAppendix,
        }),
      );
    } catch (error) {
      setProblem({ title: "Couldn't start the export", message: errorMessage(error) });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <DocumentHeader
        detail={detail}
        userId={userId}
        save={save}
        actions={
          <DraftActions
            assistant={assistant}
            editable={editable}
            llmConfigured={llmConfigured}
            canDraftFromSource={canDraftFromSource}
            emptyKeys={emptyKeys}
            onDraftAll={draftAll}
          />
        }
        onExport={() => setExporting(true)}
        onShowComments={(key) => {
          setCommentsSection(key);
          showPanel("comments");
        }}
      />
      {approved ? (
        <div className="border-b border-border bg-secondary px-4 py-2 text-[13px] text-muted-foreground">
          Approved
          {detail.statusChange?.by ? ` by ${detail.statusChange.by.name}` : ""}
          {detail.statusChange ? ` · ${timeAgo(detail.statusChange.at)}` : ""}.
          {detail.level === "edit" ? " Reopen it from the status menu to make changes." : ""}
        </div>
      ) : (
        !editable && (
          <div className="border-b border-border bg-secondary px-4 py-2 text-[13px] text-muted-foreground">
            You have view access.
          </div>
        )
      )}
      {editable && detail.templateUpgrade && (
        <TemplateUpgradeBanner
          documentId={detail.document.id}
          version={detail.templateUpgrade.version}
          busy={running}
        />
      )}
      <div role="tablist" className="flex gap-4 border-b border-border px-4 text-[13px] lg:hidden">
        {panes.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={pane === name}
            onClick={() => setPane(name)}
            className={cn(
              "-mb-px border-b-2 py-2 font-medium capitalize",
              pane === name
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <SectionOutline
          sections={detail.sections}
          labels={outlineLabels}
          onSelect={showSection}
          className={cn(
            pane === "outline" ? "flex w-full" : "hidden",
            outline === "open" ? "lg:flex" : "lg:hidden",
          )}
        />
        <main
          ref={mainRef}
          className={cn("min-w-0 flex-1 overflow-auto", pane !== "document" && "hidden lg:block")}
        >
          {/* Wider on the left: the block gutter sits in that padding. */}
          <article className="mx-auto flex max-w-[72ch] flex-col gap-10 px-6 py-10 sm:pl-11">
            <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em]">
              {doc.title}
            </h1>
            {detail.sections.map((section) => {
              const locked =
                pendingDraft.has(section.key) || assistant.proposals[section.key] !== undefined;
              return (
                <SectionBlock
                  key={`${section.key}:${generations[section.key] ?? 0}`}
                  documentId={doc.id}
                  section={section}
                  editable={editable && !locked}
                  canGenerate={canGenerate}
                  queued={pendingDraft.has(section.key) && assistant.draft?.current !== section.key}
                  streaming={assistant.streaming[section.key]}
                  proposal={assistant.proposals[section.key]}
                  accepted={accepted[section.key] !== undefined}
                  busy={busy}
                  seed={seeds[section.key]}
                  onSaved={onSaved}
                  onSaveState={onSaveState}
                  onRevise={(instruction) => revise(section.key, instruction)}
                  onDraft={() => draftOne(section)}
                  onAccept={() => void accept(section)}
                  onDiscard={() => assistant.clearProposal(section.key)}
                  onEdit={() => editBeforeAccepting(section)}
                  onUndo={() => void undo(section)}
                  onAsk={() => askAbout(section)}
                  openComments={openComments[section.key] ?? 0}
                  onComments={() => {
                    setCommentsSection(section.key);
                    showPanel("comments");
                  }}
                  onHistory={() => {
                    setHistoryKey(section.key);
                    showPanel("history");
                  }}
                />
              );
            })}
          </article>
        </main>
        <AssistantPanel
          documentId={doc.id}
          documentTitle={doc.title}
          tab={panelTab}
          onTabChange={setPanelTab}
          historyKey={historyKey}
          onHistoryKeyChange={setHistoryKey}
          onRestored={replaceSection}
          commentsKey={commentsSection}
          onCommentsKeyChange={setCommentsSection}
          sections={detail.sections}
          assistant={assistant}
          editable={editable}
          llmConfigured={llmConfigured}
          isAdmin={me.user.isAdmin}
          composer={composer}
          onComposerChange={setComposer}
          onRevise={revise}
          onReviewUpdates={reviewUpdates}
          className={cn(
            pane === "assistant" ? "flex w-full" : "hidden",
            panel === "open" ? "lg:flex" : "lg:hidden",
          )}
        />
      </div>

      <ExportDialog
        open={exporting}
        onOpenChange={setExporting}
        documentId={doc.id}
        emptyCount={emptyKeys.length}
        hasRequirements={hasRequirements}
        onQueued={setExportJob}
      />
      {exportJob && (
        <ExportToast
          key={exportJob.id}
          job={exportJob}
          onRetry={() => void retryExport(exportJob)}
          onDismiss={() => setExportJob(null)}
        />
      )}

      <ConfirmDialog
        open={problem !== null}
        title={problem?.title ?? ""}
        description={problem?.message}
        onClose={() => setProblem(null)}
      />

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{confirm?.sections ? "Redraft section?" : "Draft anyway?"}</DialogTitle>
            <DialogDescription>{confirm?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (confirm) {
                  assistant.draftSections({
                    sections: confirm.sections,
                    force: true,
                    targets: confirm.targets,
                  });
                }
                setConfirm(null);
              }}
            >
              {confirm?.sections ? "Redraft" : "Draft anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DraftActions({
  assistant,
  editable,
  llmConfigured,
  canDraftFromSource,
  emptyKeys,
  onDraftAll,
}: {
  assistant: Assistant;
  editable: boolean;
  llmConfigured: boolean;
  canDraftFromSource: boolean;
  emptyKeys: string[];
  onDraftAll: () => void;
}) {
  const { draft } = assistant;
  if (assistant.running !== null) {
    return (
      <span className="flex items-center gap-2 text-[13px]">
        {draft && (
          <span className="text-muted-foreground">
            Drafting {Math.min(draft.finished.length + 1, draft.targets.length)} of{" "}
            {draft.targets.length} section{draft.targets.length === 1 ? "" : "s"}…
          </span>
        )}
        <Button size="sm" variant="outline" onClick={assistant.stop}>
          ■ Stop
        </Button>
      </span>
    );
  }
  if (!editable) return null;

  const blocked = !llmConfigured
    ? "Add an LLM provider to start drafting"
    : assistant.coverageUpdating
      ? "Updating coverage…"
      : null;
  const disabled = blocked !== null || emptyKeys.length === 0;
  return (
    <span className="flex items-center gap-2">
      {canDraftFromSource && (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          title={blocked ?? "Assess the source document, then draft every empty section"}
          onClick={() => assistant.draftSections({ fromSource: true, targets: emptyKeys })}
        >
          Draft from source
        </Button>
      )}
      <Button
        size="sm"
        onClick={onDraftAll}
        disabled={disabled}
        title={
          blocked ??
          (emptyKeys.length === 0
            ? "Every section has content; redraft sections one at a time"
            : undefined)
        }
      >
        Draft all
      </Button>
    </span>
  );
}

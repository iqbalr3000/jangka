import {
  type DocNode,
  docContent,
  revisionConflictDetails,
  type Section,
  section as sectionSchema,
} from "@jangka/shared/document";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { useConnection } from "@/lib/connection";
import { DiagramFixContext, type FixDiagram, fixDiagram } from "@/lib/diagram-fix";
import { sectionExtensions } from "@/lib/editor-extensions";
import { errorMessage } from "@/lib/form-errors";
import { timeAgo } from "@/lib/llm";
import { BlockGutter } from "./block-gutter";
import { FormatMenu } from "./format-menu";

const AUTOSAVE_MS = 1500;
// Read-only wording matches the PDF/DOCX export.
const PLACEHOLDER = { editable: "Not enough information yet.", readOnly: "Not yet specified." };

export type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

type SectionEditorProps = {
  documentId: string;
  section: Section;
  editable: boolean;
  onSaved: (section: Section) => void;
  onSaveState: (key: string, state: SaveState) => void;
  /** Unsaved starting content (e.g. "Edit before accepting"); saved like a human edit. */
  seed?: DocNode;
};

/**
 * One section's editor. Saves are debounced and serialized: each request carries the revision the
 * previous save returned, so only another author can cause a 409.
 */
export function SectionEditor({
  documentId,
  section,
  editable,
  onSaved,
  onSaveState,
  seed,
}: SectionEditorProps) {
  const revision = useRef(section.revision);
  const pending = useRef<DocNode | null>(null);
  // Last content known to be on the server: updates that don't change it aren't saved.
  const savedJson = useRef(JSON.stringify(section.content));
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [conflict, setConflict] = useState<Section | null>(null);
  // Read inside async callbacks, which would otherwise see a stale `conflict`.
  const conflictRef = useRef<Section | null>(null);
  conflictRef.current = conflict;
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const { key } = section;

  const report = useCallback((state: SaveState) => onSaveState(key, state), [key, onSaveState]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    // While a conflict is unresolved nothing saves (blur included); the user picks a side first.
    if (inFlight.current || !pending.current || conflictRef.current) return;
    const content = pending.current;
    pending.current = null;
    inFlight.current = true;
    report("saving");
    try {
      const saved = await apiFetch(`/documents/${documentId}/sections/${key}`, {
        method: "PUT",
        body: { content, revision: revision.current },
        schema: sectionSchema,
      });
      revision.current = saved.revision;
      savedJson.current = JSON.stringify(content);
      setError(null);
      onSaved(saved);
      report(pending.current ? "saving" : "saved");
    } catch (err) {
      pending.current ??= content;
      if (err instanceof ApiError && err.code === "revision_conflict") {
        const details = revisionConflictDetails.safeParse(err.details);
        if (details.success) {
          conflictRef.current = details.data.current;
          setConflict(details.data.current);
        }
        report("conflict");
      } else {
        setError(
          err instanceof ApiError
            ? errorMessage(err)
            : "Not saved yet: this section saves when the connection is back.",
        );
        report("error");
      }
    } finally {
      inFlight.current = false;
    }
    if (pending.current && !conflictRef.current) void flush();
  }, [documentId, key, onSaved, report]);

  const editor = useEditor({
    extensions: sectionExtensions(PLACEHOLDER),
    content: seed ?? section.content,
    editable,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: "section-prose outline-none min-h-8",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": section.title,
      },
    },
    onUpdate: ({ editor: e }) => {
      const parsed = docContent.safeParse(e.getJSON());
      if (!parsed.success) {
        setError("This content can't be saved (unsupported formatting).");
        report("error");
        return;
      }
      if (JSON.stringify(parsed.data) === savedJson.current && !inFlight.current) {
        pending.current = null;
        return;
      }
      pending.current = parsed.data;
      if (conflictRef.current) return;
      // Unsaved changes count as saving, so "Saved" is never shown over pending edits.
      report("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    },
    onBlur: () => void flush(),
  });

  // `false`: setEditable would otherwise emit an update and autosave unchanged content.
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);

  // A seed is an edit the user hasn't saved yet: queue it like one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once for the seed the editor mounted with
  useEffect(() => {
    if (!seed) return;
    pending.current = seed;
    report("saving");
    timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
  }, []);

  // Edits that failed while offline are retried once the server answers again.
  const connection = useConnection();
  useEffect(() => {
    if (connection === "online" && pending.current && !conflictRef.current) void flush();
  }, [connection, flush]);

  // Don't lose the last keystrokes when leaving the page.
  useEffect(() => () => void flush(), [flush]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pending.current || inFlight.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const fix = useMemo<FixDiagram | null>(
    () => (editable ? (source, err) => fixDiagram(documentId, key, source, err) : null),
    [editable, documentId, key],
  );

  function viewTheirs() {
    if (!conflict || !editor) return;
    pending.current = null;
    revision.current = conflict.revision;
    savedJson.current = JSON.stringify(conflict.content);
    editor.commands.setContent(conflict.content, { emitUpdate: false });
    onSaved(conflict);
    conflictRef.current = null;
    setConflict(null);
    report("saved");
  }

  function overwrite() {
    if (!conflict) return;
    revision.current = conflict.revision;
    conflictRef.current = null;
    setConflict(null);
    void flush();
  }

  // Clicking under the last block continues the section, even after a table or diagram.
  function continueAtEnd(event: MouseEvent) {
    if (!editor) return;
    event.preventDefault();
    const { doc } = editor.state;
    const last = doc.lastChild;
    if (last?.type.name === "paragraph" && last.content.size === 0) {
      editor.commands.focus("end");
      return;
    }
    editor.chain().insertContentAt(doc.content.size, { type: "paragraph" }).focus("end").run();
  }

  return (
    <div className="relative flex flex-col gap-2">
      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-sm border border-status-partial bg-secondary px-3 py-2 text-[13px]"
        >
          <span className="flex-1">
            Updated by {conflict.updatedBy?.name ?? "someone else"} {timeAgo(conflict.updatedAt)}.
          </span>
          <Button size="xs" variant="outline" onClick={viewTheirs}>
            View theirs
          </Button>
          <Button size="xs" onClick={overwrite}>
            Overwrite
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {/* Wider than the text by the gutter, so moving onto the block handle keeps it shown. */}
      <div ref={setFrame} className="relative -ml-6 pl-6 sm:-ml-11 sm:pl-11">
        <DiagramFixContext value={fix}>
          <EditorContent editor={editor} />
        </DiagramFixContext>
        {editable && editor && frame && <BlockGutter editor={editor} container={frame} />}
        {editable && editor && <FormatMenu editor={editor} />}
        {editable && (
          <div
            aria-hidden
            onMouseDown={(event) => continueAtEnd(event.nativeEvent)}
            className="h-6 cursor-text"
          />
        )}
      </div>
    </div>
  );
}

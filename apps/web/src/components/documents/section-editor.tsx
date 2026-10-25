import {
  type DocNode,
  docContent,
  revisionConflictDetails,
  type Section,
  section as sectionSchema,
} from "@jangka/shared/document";
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import {
  Bold,
  Code,
  GitFork,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  SquareCode,
  Table2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { NEW_DIAGRAM, sectionExtensions } from "@/lib/editor-extensions";
import { errorMessage } from "@/lib/form-errors";
import { timeAgo } from "@/lib/llm";
import { cn } from "@/lib/utils";

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
  /** Where the formatting toolbar goes while editing: the section's heading row. */
  toolbarSlot: HTMLElement | null;
};

type ToolbarButton = { label: string; icon: LucideIcon; active?: boolean; run: () => void };

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
    }),
  });
  const chain = () => editor.chain().focus();
  const buttons: ToolbarButton[] = [
    { label: "Bold", icon: Bold, active: state.bold, run: () => chain().toggleBold().run() },
    {
      label: "Italic",
      icon: Italic,
      active: state.italic,
      run: () => chain().toggleItalic().run(),
    },
    { label: "Inline code", icon: Code, active: state.code, run: () => chain().toggleCode().run() },
    {
      label: "Link",
      icon: Link2,
      active: state.link,
      run: () => {
        if (editor.isActive("link")) return void chain().unsetLink().run();
        const href = window.prompt("Link URL (https://…)");
        if (href) chain().setLink({ href }).run();
      },
    },
    {
      label: "Bulleted list",
      icon: List,
      active: state.bullet,
      run: () => chain().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      active: state.ordered,
      run: () => chain().toggleOrderedList().run(),
    },
    {
      label: "Table",
      icon: Table2,
      run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    { label: "Code block", icon: SquareCode, run: () => chain().toggleCodeBlock().run() },
    {
      label: "Diagram",
      icon: GitFork,
      run: () =>
        chain()
          .insertContent({ type: "mermaidBlock", attrs: { source: NEW_DIAGRAM } })
          .run(),
    },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex gap-0.5 rounded-sm border border-border bg-card p-0.5"
    >
      {buttons.map(({ label, icon: Icon, active, run }) => (
        <button
          key={label}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={active}
          onMouseDown={(event) => event.preventDefault()}
          onClick={run}
          className={cn(
            "flex size-7 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-secondary hover:text-foreground",
            active && "bg-secondary text-foreground",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}

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
  toolbarSlot,
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
  const [focused, setFocused] = useState(false);
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
        setError(errorMessage(err));
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
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      void flush();
    },
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

  // Don't lose the last keystrokes when leaving the page.
  useEffect(() => () => void flush(), [flush]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pending.current || inFlight.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

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

  return (
    <div className="relative flex flex-col gap-2">
      {/* In the heading row, beside the section actions rather than over them. */}
      {editable &&
        editor &&
        focused &&
        toolbarSlot &&
        createPortal(<Toolbar editor={editor} />, toolbarSlot)}
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
      <EditorContent editor={editor} />
    </div>
  );
}

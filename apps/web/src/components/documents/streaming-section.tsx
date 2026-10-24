import { fromMarkdown } from "@jangka/export";
import type { DocNode } from "@jangka/shared/document";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect } from "react";
import { sectionExtensions } from "@/lib/editor-extensions";

function toDoc(markdown: string): DocNode {
  try {
    return fromMarkdown(markdown);
  } catch {
    return {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: markdown }] }],
    };
  }
}

/** Read-only live rendering of a section being drafted (DESIGN §6.4). */
export function StreamingSection({ markdown }: { markdown: string }) {
  const editor = useEditor({
    extensions: sectionExtensions(""),
    content: toDoc(markdown),
    editable: false,
    immediatelyRender: true,
    editorProps: { attributes: { class: "section-prose outline-none" } },
  });

  useEffect(() => {
    // Re-render at most once per frame however fast tokens arrive.
    const frame = requestAnimationFrame(() =>
      editor?.commands.setContent(toDoc(markdown), { emitUpdate: false }),
    );
    return () => cancelAnimationFrame(frame);
  }, [editor, markdown]);

  return (
    <div className="border-l-2 border-primary pl-4" aria-live="polite" aria-busy="true">
      {markdown.trim() === "" ? (
        <p className="text-[15px] text-muted-foreground">Drafting…</p>
      ) : (
        <EditorContent editor={editor} />
      )}
      <span className="inline-block animate-pulse text-primary" aria-hidden>
        ▍
      </span>
    </div>
  );
}

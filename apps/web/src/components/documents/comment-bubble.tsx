import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { MessageSquare } from "lucide-react";

/** "Comment" above selected words in a read-only section (viewers, approved documents). */
export function CommentBubble({ editor, onComment }: { editor: Editor; onComment: () => void }) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="commentBubble"
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor: e, state: s, from, to }) => {
        if (e.isEditable || from === to) return false;
        if (s.selection instanceof NodeSelection) return false;
        return !e.isActive("codeBlock");
      }}
      className="z-40 rounded-md border border-border bg-card p-0.5 text-[13px] shadow-[0_4px_16px_rgb(0_0_0/0.08)]"
    >
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onComment}
        className="flex h-7 items-center gap-1 rounded-sm px-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <MessageSquare className="size-3.5" aria-hidden />
        Comment
      </button>
    </BubbleMenu>
  );
}

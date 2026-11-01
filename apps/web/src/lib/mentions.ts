/** The open `@query` right before the caret, if the caret is in one. */
export function mentionAt(text: string, caret: number): { from: number; query: string } | null {
  const match = /(?:^|\s)@([^\s@[\]()]{0,30})$/.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[1] ?? "";
  return { from: caret - query.length - 1, query };
}

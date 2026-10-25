import { snippetParts } from "@jangka/shared/search";

/** A search snippet with matched words in <mark>; text is rendered as text, never as HTML. */
export function Snippet({ value }: { value: string }) {
  return (
    <>
      {snippetParts(value).map((part, i) =>
        part.marked ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts have no identity beyond position
          <mark key={i} className="rounded-[2px] bg-diff-add px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts have no identity beyond position
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

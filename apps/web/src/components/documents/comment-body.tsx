import { bodyParts } from "@jangka/shared/notifications";

export function CommentBody({ body }: { body: string }) {
  return bodyParts(body).map((part, i) =>
    "mention" in part ? (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and never reordered
        key={i}
        className="rounded-sm bg-primary/10 px-1 font-medium text-primary"
      >
        @{part.mention.name}
      </span>
    ) : (
      part.text
    ),
  );
}

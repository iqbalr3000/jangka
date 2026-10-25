import type { LinkedDocument } from "@jangka/shared/document";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { docTypeLabels } from "@/lib/trace";

/** `↑ BRD · Title`, or a lock with no title or type when the viewer can't see the source. */
export function SourceChip({ source }: { source: LinkedDocument }) {
  const className =
    "flex max-w-56 shrink-0 items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-xs";
  if ("restricted" in source) {
    return (
      <span className={`${className} text-muted-foreground`}>
        ↑ <Lock className="size-3" aria-hidden /> Restricted document
      </span>
    );
  }
  return (
    <Link
      to="/d/$documentId"
      params={{ documentId: source.id }}
      className={`${className} hover:bg-secondary`}
      title={`Generated from ${source.title}`}
    >
      ↑ <span className="font-mono text-[11px]">{docTypeLabels[source.docType]}</span>
      <span className="truncate">· {source.title}</span>
    </Link>
  );
}

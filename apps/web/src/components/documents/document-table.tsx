import type { DocumentSummary } from "@jangka/shared/document";
import { Link } from "@tanstack/react-router";
import { timeAgo } from "@/lib/llm";
import { cn } from "@/lib/utils";
import { CompletenessStrip } from "./completeness-strip";
import { DocTypeBadge } from "./doc-type-badge";

const columns = "grid grid-cols-[56px_minmax(0,1fr)_96px_minmax(0,140px)_96px] items-center gap-4";
const headerClass = "font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground";
const statusLabels: Record<DocumentSummary["status"], string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
};

export function DocumentTable({ documents }: { documents: DocumentSummary[] }) {
  return (
    <section aria-label="Documents" className="rounded-md border border-border bg-card">
      <div className={cn(columns, headerClass, "border-b border-border px-4 py-2.5")}>
        <span>TYPE</span>
        <span>TITLE</span>
        <span>STATUS</span>
        <span>COMPLETE</span>
        <span>UPDATED</span>
      </div>
      {documents.map((doc) => (
        <Link
          key={doc.id}
          to="/d/$documentId"
          params={{ documentId: doc.id }}
          className={cn(
            columns,
            "border-b border-border px-4 py-3 text-sm last:border-b-0 hover:bg-secondary",
          )}
        >
          <DocTypeBadge docType={doc.docType} className="justify-self-start" />
          <span className="truncate font-medium">{doc.title}</span>
          <span className="text-muted-foreground">{statusLabels[doc.status]}</span>
          <CompletenessStrip values={doc.completeness} />
          <span className="text-muted-foreground">{timeAgo(doc.updatedAt)}</span>
        </Link>
      ))}
    </section>
  );
}

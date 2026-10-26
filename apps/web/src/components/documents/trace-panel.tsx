import type { DocumentRef } from "@jangka/shared/document";
import type { RequirementView } from "@jangka/shared/trace";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { z } from "zod";
import { ErrorBanner } from "@/components/error-banner";
import { LoadingRows } from "@/components/loading-rows";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { timeAgo } from "@/lib/llm";
import { docTypeLabels, traceKey, traceQuery } from "@/lib/trace";
import { cn } from "@/lib/utils";

const KIND_LABELS: Record<RequirementView["kind"], string> = {
  business: "Business requirements",
  functional: "Functional requirements",
  non_functional: "Non-functional requirements",
  technical: "Technical requirements",
};

const PRIORITY_LABELS = { must: "Must", should: "Should", could: "Could" } as const;

const chip = "rounded-[3px] border border-border-strong px-1 font-mono text-[11px]";

function DocLink({ doc }: { doc: DocumentRef }) {
  return (
    <Link
      to="/d/$documentId"
      params={{ documentId: doc.id }}
      className="flex min-w-0 items-center gap-1 hover:underline"
    >
      <span className="font-mono text-[11px] text-muted-foreground">
        {docTypeLabels[doc.docType]}
      </span>
      <span className="truncate">{doc.title}</span>
    </Link>
  );
}

function Restricted() {
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <Lock className="size-3" aria-hidden /> Restricted document
    </span>
  );
}

function Requirement({
  requirement,
  onReviewed,
}: {
  requirement: RequirementView;
  /** Editors only. */
  onReviewed?: () => void;
}) {
  const linked = requirement.upstream.filter((u) => u.status !== "restricted");
  const restricted = requirement.upstream.some((u) => u.status === "restricted");
  return (
    <li
      className={cn(
        "flex flex-col gap-1 border-b border-border py-2 last:border-0",
        requirement.needsReview && "-mx-2 border-l-2 border-l-status-partial px-2",
      )}
    >
      <div className="flex items-start gap-2">
        <span className={chip}>{requirement.code}</span>
        <span className="min-w-0 flex-1">{requirement.text}</span>
        {requirement.priority && (
          <span className="text-[11px] text-muted-foreground">
            {PRIORITY_LABELS[requirement.priority]}
          </span>
        )}
      </div>
      {requirement.needsReview && (
        <div className="flex items-center gap-2 pl-1 text-xs text-status-partial">
          Needs review: upstream changed
          {onReviewed && (
            <button
              type="button"
              onClick={onReviewed}
              className="ml-auto rounded-sm border border-border px-1.5 text-muted-foreground hover:bg-secondary"
            >
              Mark reviewed
            </button>
          )}
        </div>
      )}
      {(linked.length > 0 || restricted) && (
        <div className="flex flex-wrap items-center gap-1.5 pl-1 text-xs">
          <span className="text-muted-foreground" aria-hidden>
            ↑
          </span>
          <span className="sr-only">Upstream</span>
          {linked.map((ref) =>
            ref.status === "linked" ? (
              <Link
                key={ref.code}
                to="/d/$documentId"
                params={{ documentId: ref.documentId }}
                title={ref.changedAt ? `${ref.text} (changed ${timeAgo(ref.changedAt)})` : ref.text}
                className={cn(
                  chip,
                  "hover:bg-secondary",
                  ref.changedAt && "border-status-partial text-status-partial",
                )}
              >
                {ref.code}
                {ref.changedAt && " · changed"}
              </Link>
            ) : (
              <span
                key={ref.code}
                title="Not in the source document"
                className={`${chip} border-status-partial text-status-partial`}
              >
                {ref.code} · not in source
              </span>
            ),
          )}
          {restricted && <Restricted />}
        </div>
      )}
      {requirement.downstream.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pl-1 text-xs">
          <span className="text-muted-foreground" aria-hidden>
            ↓
          </span>
          <span className="sr-only">Downstream</span>
          {requirement.downstream.map((ref) => (
            <Link
              key={`${ref.documentId}:${ref.code}`}
              to="/d/$documentId"
              params={{ documentId: ref.documentId }}
              title={ref.text}
              className={`${chip} hover:bg-secondary`}
            >
              {ref.code}
            </Link>
          ))}
        </div>
      )}
    </li>
  );
}

/** Document chain plus each requirement's upstream and downstream links. */
export function TracePanel({
  documentId,
  title,
  editable,
}: {
  documentId: string;
  title: string;
  /** Edit access on a document that isn't approved: may mark requirements reviewed. */
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const trace = useQuery(traceQuery(documentId));
  const reviewed = useMutation({
    mutationFn: (code: string) =>
      apiFetch(`/documents/${documentId}/requirements/${code}/reviewed`, {
        method: "POST",
        schema: z.undefined(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: traceKey(documentId) }),
  });

  if (trace.isPending) {
    return <LoadingRows className="px-4 py-3" />;
  }
  if (trace.error) {
    return (
      <div className="p-4">
        <ErrorBanner>{errorMessage(trace.error)}</ErrorBanner>
      </div>
    );
  }
  const { upstream, downstream, requirements, needsReviewCount } = trace.data;
  const kinds = [...new Set(requirements.map((r) => r.kind))];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto text-[13px]">
      <section
        aria-label="Document chain"
        className="flex flex-col gap-1 border-b border-border px-4 py-3"
      >
        {upstream && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">↑</span>
            {"restricted" in upstream ? <Restricted /> : <DocLink doc={upstream} />}
          </div>
        )}
        <div className="flex items-center gap-1.5 font-medium">
          <span className="text-muted-foreground">•</span>
          <span className="truncate">{title}</span>
          {needsReviewCount > 0 && (
            <span className="ml-auto shrink-0 text-xs font-normal text-status-partial">
              {needsReviewCount} need{needsReviewCount === 1 ? "s" : ""} review
            </span>
          )}
        </div>
        {downstream.map((doc) => (
          <div key={doc.id} className="flex items-center gap-1.5">
            <span className="text-muted-foreground">↓</span>
            <DocLink doc={doc} />
          </div>
        ))}
      </section>
      {requirements.length === 0 ? (
        <p className="px-4 py-3 text-muted-foreground">
          No requirements yet. Requirement sections use a table with the columns ID | Requirement |
          Priority | Upstream; each row with an ID such as FR-001 is tracked here.
        </p>
      ) : (
        kinds.map((kind) => (
          <section key={kind} className="px-4 py-2">
            <h3 className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
              {KIND_LABELS[kind]}
            </h3>
            <ul>
              {requirements
                .filter((r) => r.kind === kind)
                .map((r) => (
                  <Requirement
                    key={r.code}
                    requirement={r}
                    onReviewed={editable ? () => reviewed.mutate(r.code) : undefined}
                  />
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

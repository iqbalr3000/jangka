import type { InterviewState } from "@jangka/shared/assistant";
import type { Section } from "@jangka/shared/document";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { chatQuery } from "@/lib/assistant";

type UpdateSuggestionsProps = {
  documentId: string;
  suggestions: InterviewState["suggestions"];
  sections: Section[];
  onReview: (suggestions: InterviewState["suggestions"]) => void;
};

/** "This may change 2 sections" under the latest reply: review proposals or dismiss. */
export function UpdateSuggestions({
  documentId,
  suggestions,
  sections,
  onReview,
}: UpdateSuggestionsProps) {
  const queryClient = useQueryClient();
  const chatKey = chatQuery(documentId).queryKey;
  const dismiss = useMutation({
    mutationFn: () =>
      apiFetch(`/documents/${documentId}/chat/suggestions`, {
        method: "DELETE",
        schema: z.undefined(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatKey }),
  });

  const titles = new Map(sections.map((s) => [s.key, s.title]));
  const named = suggestions.filter((s) => titles.has(s.key));
  if (named.length === 0) return null;

  return (
    <li
      aria-label="Suggested updates"
      className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 text-[13px]"
    >
      <span className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
        <span>
          This may change {named.length === 1 ? "1 section" : `${named.length} sections`}:
        </span>
      </span>
      <ul className="flex flex-col gap-1 pl-5.5">
        {named.map((s) => (
          <li key={s.key} className="flex flex-col">
            <span className="font-medium">{titles.get(s.key)}</span>
            <span className="text-xs text-muted-foreground">{s.reason}</span>
          </li>
        ))}
      </ul>
      <span className="flex gap-2 pl-5.5">
        <Button size="xs" onClick={() => onReview(named)}>
          Review updates
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate()}
        >
          Dismiss
        </Button>
      </span>
    </li>
  );
}

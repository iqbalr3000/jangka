import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { llmStatusQuery } from "@/lib/llm";

/** Admins only: nudges towards configuring a provider until a default model exists. */
export function LlmBanner() {
  const status = useQuery(llmStatusQuery);
  if (status.data?.configured !== false) return null;
  return (
    <div
      role="status"
      className="mx-10 mt-6 flex items-center gap-3 rounded-sm border border-border bg-secondary px-3 py-2.5 text-[13px]"
    >
      <span className="size-2 shrink-0 rounded-full bg-status-partial" aria-hidden />
      <span className="flex-1">Add an LLM provider to start drafting.</span>
      <Link to="/admin/llm" className="font-medium text-primary hover:underline">
        Set up LLM
      </Link>
    </div>
  );
}

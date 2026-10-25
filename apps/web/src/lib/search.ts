import { searchResponse } from "@jangka/shared/search";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiFetch } from "./api";

export const MIN_SEARCH = 2;

export const searchQuery = (q: string, options: { type?: string; limit: number }) =>
  queryOptions({
    queryKey: ["search", q, options.type ?? "", options.limit],
    queryFn: () => {
      const params = new URLSearchParams({ q, limit: String(options.limit) });
      if (options.type) params.set("type", options.type);
      return apiFetch(`/search?${params}`, { schema: searchResponse });
    },
    enabled: q.trim().length >= MIN_SEARCH,
    // Keep showing the last results while the next keystroke's request runs.
    placeholderData: keepPreviousData,
  });

/** `value` once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 200): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

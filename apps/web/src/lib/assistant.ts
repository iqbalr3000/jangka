import { type AssistantEvent, assistantEvent, chatThread } from "@jangka/shared/assistant";
import { errorResponseSchema } from "@jangka/shared/errors";
import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiFetch } from "./api";

export const chatQuery = (documentId: string) =>
  queryOptions({
    queryKey: ["documents", documentId, "chat"],
    queryFn: () => apiFetch(`/documents/${documentId}/chat`, { schema: chatThread }),
  });

/**
 * POSTs to an SSE endpoint (EventSource can't POST) and feeds each validated event to `onEvent`.
 * Errors before the stream starts surface as `ApiError`; aborting the signal stops the server-side
 * generation (and the provider call).
 */
export async function streamAssistant(
  path: string,
  body: unknown,
  { signal, onEvent }: { signal: AbortSignal; onEvent: (event: AssistantEvent) => void },
): Promise<void> {
  const res = await fetch(`/api/v1${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const parsed = errorResponseSchema.safeParse(await res.json().catch(() => undefined));
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(code, res.status, message, details);
    }
    throw new ApiError("internal", res.status, `Request failed with status ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const event = assistantEvent.safeParse(JSON.parse(data));
        if (event.success) onEvent(event.data);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** Line diff via LCS: fine for section-sized markdown. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = lcs[i] ?? [];
      row[j] =
        a[i] === b[j]
          ? (lcs[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(lcs[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] ?? "" });
      i++;
      j++;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      out.push({ kind: "del", text: a[i++] ?? "" });
    } else {
      out.push({ kind: "add", text: b[j++] ?? "" });
    }
  }
  while (i < a.length) out.push({ kind: "del", text: a[i++] ?? "" });
  while (j < b.length) out.push({ kind: "add", text: b[j++] ?? "" });
  return out.filter((line) => !(line.kind !== "same" && line.text.trim() === ""));
}

/** Changed blocks (consecutive add/del runs) — "3 changes". */
export function changeCount(diff: DiffLine[]): number {
  let count = 0;
  let inChange = false;
  for (const line of diff) {
    if (line.kind !== "same" && !inChange) count++;
    inChange = line.kind !== "same";
  }
  return count;
}

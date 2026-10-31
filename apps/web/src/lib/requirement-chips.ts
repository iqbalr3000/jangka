import type { TraceResponse } from "@jangka/shared/trace";

/** What a requirement code in the text refers to, as the Trace panel resolved it. */
export type Chip =
  | {
      kind: "own";
      code: string;
      text: string;
      priority: string | null;
      upstream: string[];
      needsReview: boolean;
    }
  | { kind: "upstream"; code: string; text: string; source: string; focus: string }
  | { kind: "restricted"; code: string; focus: string }
  | { kind: "missing"; code: string; focus: string };

export type ChipIndex = ReadonlyMap<string, Chip>;

export const EMPTY_CHIPS: ChipIndex = new Map();

const CODE = /\b(?:BR|FR|NFR|TR)-\d{3,}\b/g;

/** Requirement codes in `text` with their offsets. */
export function findCodes(text: string): { code: string; from: number; to: number }[] {
  return [...text.matchAll(CODE)].map((m) => ({
    code: m[0],
    from: m.index,
    to: m.index + m[0].length,
  }));
}

/**
 * Own requirements first; an upstream code points at the first own requirement citing it, which
 * is where the Trace panel scrolls on click.
 */
export function chipIndex(trace: TraceResponse | undefined): ChipIndex {
  const index = new Map<string, Chip>();
  if (!trace) return index;
  const source = trace.upstream && "title" in trace.upstream ? trace.upstream.title : "";
  for (const r of trace.requirements) {
    index.set(r.code, {
      kind: "own",
      code: r.code,
      text: r.text,
      priority: r.priority,
      upstream: r.upstream.map((u) => u.code),
      needsReview: r.needsReview,
    });
  }
  for (const r of trace.requirements) {
    for (const ref of r.upstream) {
      if (index.has(ref.code)) continue;
      index.set(
        ref.code,
        ref.status === "linked"
          ? { kind: "upstream", code: ref.code, text: ref.text, source, focus: r.code }
          : { kind: ref.status, code: ref.code, focus: r.code },
      );
    }
  }
  return index;
}

/** The own requirement the Trace panel should show for a chip. */
export const focusOf = (chip: Chip) => (chip.kind === "own" ? chip.code : chip.focus);

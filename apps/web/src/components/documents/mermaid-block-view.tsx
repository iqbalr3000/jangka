import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { AlertTriangle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Mode = "preview" | "source";
type Render = { svg: string } | { error: string } | null;

let mermaidModule: Promise<typeof import("mermaid").default> | null = null;

/** Loaded on first diagram only: mermaid is large. */
function loadMermaid() {
  mermaidModule ??= import("mermaid").then(({ default: mermaid }) => {
    const dark =
      document.documentElement.dataset.theme === "dark" ||
      (document.documentElement.dataset.theme !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "neutral",
      fontFamily: "Inter Variable, system-ui, sans-serif",
    });
    return mermaid;
  });
  return mermaidModule;
}

function useMermaidRender(source: string, enabled: boolean): Render {
  const [result, setResult] = useState<Render>(null);
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    if (!enabled || source.trim() === "") {
      setResult(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        const { svg } = await mermaid.render(id, source);
        if (!cancelled) setResult({ svg });
      } catch (error) {
        if (!cancelled) {
          setResult({ error: error instanceof Error ? error.message : "Invalid diagram" });
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, enabled, id]);

  return result;
}

export function MermaidBlockView({ node, updateAttributes, editor, selected }: ReactNodeViewProps) {
  const source = typeof node.attrs.source === "string" ? node.attrs.source : "";
  const [mode, setMode] = useState<Mode>(source.trim() ? "preview" : "source");
  const render = useMermaidRender(source, true);
  const svgRef = useRef<HTMLDivElement>(null);
  const editable = editor.isEditable;

  // Mermaid's strict security level sanitizes its own output.
  useEffect(() => {
    if (svgRef.current) svgRef.current.innerHTML = render && "svg" in render ? render.svg : "";
  }, [render]);

  const error = render && "error" in render ? render.error : null;

  return (
    <NodeViewWrapper
      className={cn(
        "my-4 overflow-hidden rounded-md border border-border bg-card",
        selected && "ring-2 ring-ring/50",
      )}
      data-mermaid
    >
      <div
        className="flex items-center gap-2 border-b border-border bg-secondary px-3 py-1.5"
        contentEditable={false}
      >
        <span className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground">
          MERMAID
        </span>
        {error && (
          <span className="flex items-center gap-1 text-xs text-destructive" title={error}>
            <AlertTriangle className="size-3" aria-hidden />
            Render error
          </span>
        )}
        <span className="flex-1" />
        <fieldset className="flex rounded-sm border border-border text-xs">
          <legend className="sr-only">View</legend>
          {(["source", "preview"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={cn(
                "px-2 py-0.5 capitalize",
                mode === option ? "bg-card font-medium" : "text-muted-foreground",
              )}
            >
              {option}
            </button>
          ))}
        </fieldset>
      </div>
      {mode === "source" ? (
        <textarea
          aria-label="Mermaid source"
          value={source}
          readOnly={!editable}
          spellCheck={false}
          rows={Math.min(16, Math.max(4, source.split("\n").length + 1))}
          onChange={(event) => updateAttributes({ source: event.target.value })}
          className="block w-full resize-y bg-card p-3 font-mono text-[13px] outline-none"
          contentEditable={false}
        />
      ) : (
        <div className="flex min-h-24 justify-center overflow-auto p-4" contentEditable={false}>
          {source.trim() === "" && (
            <p className="text-[13px] text-muted-foreground">Empty diagram.</p>
          )}
          {error && <pre className="text-xs whitespace-pre-wrap text-destructive">{error}</pre>}
          <div ref={svgRef} role="img" aria-label="Diagram preview" />
        </div>
      )}
    </NodeViewWrapper>
  );
}

import { useState } from "react";
import { cn } from "@/lib/utils";

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure origin or permission); the value stays selectable.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={cn("shrink-0 text-xs font-medium text-primary hover:underline", className)}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

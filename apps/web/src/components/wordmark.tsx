import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn("text-[19px] leading-none font-semibold tracking-[-0.03em]", className)}
      role="img"
      aria-label="Jangka"
    >
      j<span className="text-primary">Λ</span>ngka
    </span>
  );
}

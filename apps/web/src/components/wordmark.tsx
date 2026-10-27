import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-[19px] leading-none font-bold tracking-[-0.045em] whitespace-nowrap",
        className,
      )}
      role="img"
      aria-label="Jangka"
    >
      j
      {/* The compass Λ from docs/assets/jangka-mark.svg without its dot; feet sit on the baseline. */}
      <svg
        viewBox="0 0 540 582"
        aria-hidden="true"
        className="mr-[0.05em] ml-[0.04em] inline-block h-[0.582em] w-[0.54em] align-baseline text-primary"
      >
        <polyline
          points="54,528 270,54 486,528"
          fill="none"
          stroke="currentColor"
          strokeWidth="108"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      ngka
    </span>
  );
}

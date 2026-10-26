import { WifiOff } from "lucide-react";
import { useConnection } from "@/lib/connection";

/** Offline / server down. Unsaved section edits stay in the tab and save on reconnect. */
export function ConnectionBanner() {
  const connection = useConnection();
  if (connection === "online") return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-border bg-diff-del px-4 py-2 text-[13px] text-destructive"
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden />
      {connection === "offline" ? "You're offline." : "Can't reach the Jangka server. Retrying…"}{" "}
      Your edits are kept in this tab and saved when the connection is back.
    </div>
  );
}

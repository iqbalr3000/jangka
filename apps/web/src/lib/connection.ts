import { useEffect, useSyncExternalStore } from "react";

/** `unreachable`: the browser is online but the server (or its database) isn't answering. */
export type Connection = "online" | "offline" | "unreachable";

const RECHECK_MS = 5000;

let state: Connection = navigator.onLine ? "online" : "offline";
const listeners = new Set<() => void>();

function set(next: Connection) {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener();
}

/** Fed by `apiFetch`: whether the last request got through to a working server. */
export function reportRequest(reached: boolean) {
  if (!navigator.onLine) set("offline");
  else set(reached ? "online" : "unreachable");
}

window.addEventListener("offline", () => set("offline"));
window.addEventListener("online", () => set("unreachable"));

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current connection; while it's down, the health endpoint is polled until the server answers. */
export function useConnection(): Connection {
  const current = useSyncExternalStore(subscribe, () => state);

  useEffect(() => {
    if (current === "online") return;
    const timer = setInterval(async () => {
      if (!navigator.onLine) return;
      try {
        const res = await fetch("/api/v1/health", { cache: "no-store" });
        if (res.ok) set("online");
      } catch {
        // Still down; try again on the next tick.
      }
    }, RECHECK_MS);
    return () => clearInterval(timer);
  }, [current]);

  return current;
}

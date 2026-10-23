import { useCallback, useState } from "react";

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return allowed.find((option) => option === value) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Per-browser UI preference; storage failures (private mode, blocked) fall back silently. */
export function usePersistentState<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState(() => read(key, allowed, fallback));
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Preference only lasts for this page load.
      }
    },
    [key],
  );
  return [value, update];
}

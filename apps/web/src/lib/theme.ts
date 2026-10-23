import { useEffect } from "react";
import { usePersistentState } from "./persistent-state";

export const themes = ["system", "light", "dark"] as const;
export type Theme = (typeof themes)[number];

/** Must match the pre-paint script in index.html. */
export const THEME_STORAGE_KEY = "jangka.theme";

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = usePersistentState(THEME_STORAGE_KEY, themes, "system");

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  return [theme, setTheme];
}

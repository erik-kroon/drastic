import { useSyncExternalStore } from "react";
import { usePreference } from "@/lib/preference";

export const themes = ["system", "light", "dark"] as const;

export type Theme = (typeof themes)[number];

const key = "drastic.theme";

const darkQuery = "(prefers-color-scheme: dark)";

// Runs before first paint so a saved or system dark preference never flashes
// light. React then renders the same class on <html> from useDarkTheme.
export const themeScript = `(()=>{try{const t=localStorage.getItem("${key}");const d=t==="dark"||(t!=="light"&&matchMedia("${darkQuery}").matches);document.documentElement.classList.toggle("dark",d)}catch{}})()`;

function subscribeSystem(listener: () => void) {
  const query = window.matchMedia(darkQuery);
  query.addEventListener("change", listener);

  return () => query.removeEventListener("change", listener);
}

export function useTheme() {
  return usePreference(key, themes, "system");
}

export function useDarkTheme() {
  const [theme] = useTheme();

  const system = useSyncExternalStore(
    subscribeSystem,
    () => window.matchMedia(darkQuery).matches,
    () => false,
  );

  return theme === "dark" || (theme === "system" && system);
}

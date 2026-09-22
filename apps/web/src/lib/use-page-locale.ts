import { useHydrated } from "@tanstack/react-router";
import { baseLocale, getLocale } from "@/paraglide/runtime";

/** Match the prerendered language before reading browser-only preferences. */
export function usePageLocale() {
  return useHydrated() ? getLocale() : baseLocale;
}

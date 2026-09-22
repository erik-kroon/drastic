import en from "../../messages/en.json";
import sv from "../../messages/sv.json";
import type { Locale } from "@/paraglide/runtime";

export function accountingCopy(locale: Locale) {
  return locale === "sv" ? sv : en;
}

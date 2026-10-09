import type { ClosingState } from "./portfolio-model";
import type { Locale } from "@/paraglide/runtime";

export function closingLabel(state: ClosingState, locale: Locale) {
  const sv = locale === "sv";

  switch (state.kind) {
    case "blocked":
      return sv
        ? `${state.failed.length} hinder för bokslut`
        : `${state.failed.length} closing blockers`;
    case "clear":
      return sv ? "Inga tekniska hinder" : "No technical blockers";
    case "locked":
      return sv ? "Perioden är låst" : "Period locked";
    case "unknown":
      return sv ? "Okänt" : "Unknown";
  }
}

export function ClientClosing({ state, locale }: { state: ClosingState; locale: Locale }) {
  return <span>{closingLabel(state, locale)}</span>;
}

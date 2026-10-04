import * as Schema from "effect/Schema";

export const OnboardingView = Schema.Literals([
  "start",
  "profile",
  "compatibility",
  "workspace",
  "sources",
  "import",
  "mapping",
  "opening",
  "verification",
  "responsibilities",
  "cutover",
  "delta",
  "confirmation",
  "activation",
  "first-period",
]);

export type OnboardingView = typeof OnboardingView.Type;

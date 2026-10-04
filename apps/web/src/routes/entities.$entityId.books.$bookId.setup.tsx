import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { OnboardingPanel } from "@/components/onboarding/panel";
import { OnboardingView } from "@/components/onboarding/views";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/setup")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({ view: Schema.optional(OnboardingView) }),
  ),
  component: SetupPage,
});

function SetupPage() {
  const search = Route.useSearch();
  return <OnboardingPanel view={search.view ?? "workspace"} />;
}

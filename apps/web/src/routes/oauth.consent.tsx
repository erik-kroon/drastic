import { createFileRoute } from "@tanstack/react-router";
import { OAuthAccess } from "@/components/oauth-access";

export const Route = createFileRoute("/oauth/consent")({ component: Page });

function Page() {
  return <OAuthAccess screen="consent" />;
}

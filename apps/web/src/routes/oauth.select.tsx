import { createFileRoute } from "@tanstack/react-router";
import { OAuthAccess } from "@/components/oauth-access";

export const Route = createFileRoute("/oauth/select")({ component: Page });

function Page() {
  return <OAuthAccess screen="select" />;
}

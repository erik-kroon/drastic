import { createFileRoute } from "@tanstack/react-router";
import { OAuthAccess } from "@/components/oauth-access";

export const Route = createFileRoute("/login")({ component: Page });

function Page() {
  return <OAuthAccess screen="login" />;
}

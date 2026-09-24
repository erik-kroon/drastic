import { createFileRoute } from "@tanstack/react-router";
import { CompanySetupPanel } from "@/components/company-setup/panel";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/setup")({
  component: CompanySetupPanel,
});

import { createFileRoute } from "@tanstack/react-router";
import { CompanyOverview } from "@/components/company-overview";
export const Route = createFileRoute("/entities/$entityId/books/$bookId/overview")({
  component: CompanyOverview,
});

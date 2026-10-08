import { createFileRoute } from "@tanstack/react-router";
import { WorkHome } from "@/components/work-home";
import * as Schema from "effect/Schema";
import { WorkHomeQuery } from "@/lib/work-return";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/")({
  component: WorkHome,
  validateSearch: Schema.decodeUnknownSync(WorkHomeQuery),
});

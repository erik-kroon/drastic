import { createFileRoute } from "@tanstack/react-router";
import { WorkHome } from "@/components/work-home";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/")({ component: WorkHome });

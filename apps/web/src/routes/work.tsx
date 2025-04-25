import { createFileRoute } from "@tanstack/react-router";
import { Work } from "../lib/components/sections/work";

export const Route = createFileRoute("/work")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="min-h-screen pt-16 w-full flex justify-center">
      <Work />
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import StackingCardDemo from "../lib/components/blocks/stacking-card-demo";

export const Route = createFileRoute("/work")({
  component: RouteComponent,
});

function RouteComponent() {
  return <StackingCardDemo />;
}

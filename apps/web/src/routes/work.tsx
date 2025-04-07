import { createFileRoute } from "@tanstack/react-router";
import { GradientBg1 } from "../lib/components/gradient/bg-1";

export const Route = createFileRoute("/work")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div>
      <div className="pt-60 w-full flex justify-center text-7xl font-semibold">
        Our work
      </div>

      <GradientBg1 />
    </div>
  );
}

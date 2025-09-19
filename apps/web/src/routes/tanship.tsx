import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/tanship")({
  component: RouteComponent,
  beforeLoad: () => {
    throw redirect({
      href: "https://buy.polar.sh/polar_cl_mIHecT8cn4OlUqyssQK735GjcQcbtJQ80iVUm1k67Zm",
      replace: true,
    });
  },
});

function RouteComponent() {
  return <div>Hello "/autoseo"!</div>;
}

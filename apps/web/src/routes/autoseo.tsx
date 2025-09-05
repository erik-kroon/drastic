import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/autoseo")({
  component: RouteComponent,
  beforeLoad: () => {
    throw redirect({
      href: "https://autoseo.dev",
      replace: true,
    });
  },
});

function RouteComponent() {
  return <div>Hello "/autoseo"!</div>;
}

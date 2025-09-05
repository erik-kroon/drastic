import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/tanship")({
  component: RouteComponent,
  beforeLoad: () => {
    throw redirect({
      href: "https://polar.sh/checkout/polar_c_JwWXtg69qucFD8M6ajR4A9NyhCHKlLFt8wzBY1deIIy",
      replace: true,
    });
  },
});

function RouteComponent() {
  return <div>Hello "/autoseo"!</div>;
}

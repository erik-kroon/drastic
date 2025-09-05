import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/tanship")({
  component: RouteComponent,
  beforeLoad: () => {
    throw redirect({
      href: "https://polar.sh/checkout/polar_c_MmJt4MdAiQ5Qv9zhpRZOxr6tByoenB1og4iF20jKVFA",
      replace: true,
    });
  },
});

function RouteComponent() {
  return <div>Hello "/autoseo"!</div>;
}

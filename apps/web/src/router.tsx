import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import { DefaultCatchBoundary } from "./lib/components/ui/catch-boundary";
import { NotFound } from "./lib/components/ui/not-found";
import { routeTree } from "./routeTree.gen";

export function createRouter() {
  return createTanStackRouter({
    routeTree,
    context: {
      theme: "dark",
    },
    defaultPreload: "intent",
    defaultSsr: true,
    scrollRestoration: true,
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: NotFound,
    scrollRestorationBehavior: "instant",
    defaultStructuralSharing: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}

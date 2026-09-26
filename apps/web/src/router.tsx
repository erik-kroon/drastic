import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { routeTree } from "./routeTree.gen";
import { booksKey } from "./lib/accounting-api";

export function getRouter() {
  const loseAccountingSession = (error: Error) => {
    if (!(error instanceof Accounting.AccountingError) || error.code !== "Unauthorized") return;
    void queryClient.cancelQueries({ queryKey: ["accounting"] });
    // Notify existing gate observers before retiring their query object.
    queryClient.setQueryData(booksKey, null);
    queryClient.removeQueries({ queryKey: ["accounting"] });
    // Retiring mutations does not cancel their requests or undo committed writes.
    queryClient.getMutationCache().clear();
    queryClient.setQueryData(booksKey, null);
  };

  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (Object.is(queryClient.getQueryCache().get(query.queryHash), query)) {
          loseAccountingSession(error);
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (
          queryClient
            .getMutationCache()
            .getAll()
            .some((entry) => Object.is(entry, mutation))
        ) {
          loseAccountingSession(error);
        }
      },
    }),
    defaultOptions: { queries: { staleTime: 30_000 } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });

  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}

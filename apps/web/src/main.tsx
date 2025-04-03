import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";
import Loader from "./components/loader";
import { routeTree } from "./routeTree.gen";
import { DefaultCatchBoundary } from "./components/ui/catch-boundary";
import { NotFound } from "./components/ui/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60, // 1 minute
    },
  },
});

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  context: { queryClient, user: null, theme: "dark" },

  defaultPreloadStaleTime: 0,
  defaultErrorComponent: DefaultCatchBoundary,
  defaultNotFoundComponent: NotFound,
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPendingComponent: () => <Loader />,
  Wrap: function WrapComponent({ children }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  },
});

// Register things for typesafety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");
if (!rootElement) throw new Error("Root element not found");

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<RouterProvider router={router} />);
}

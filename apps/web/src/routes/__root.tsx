import Header from "@/components/header";
import Loader from "@/components/loader";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import "../index.css";
import { Footer } from "../components/ui/footer";

export const Route = createRootRouteWithContext()({
  component: RootComponent,

  head: () => ({
    meta: [
      {
        title: "drastic",
      },
      {
        name: "description",
        content: "drastic is a software development company",
      },
    ],
    links: [
      {
        rel: "icon",
        href: "/favicon.ico",
      },
    ],
  }),
});
function RootComponent() {
  const isFetching = useRouterState({
    select: (s) => s.isLoading,
  });
  return (
    <div className="bg-background">
      <HeadContent />
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <Header />
        {isFetching && <Loader />}
        <Outlet />
        <Footer />
        <Toaster richColors />
      </ThemeProvider>
      <Scripts />
      <TanStackRouterDevtools position="bottom-left" />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
    </div>
  );
}

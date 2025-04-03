import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";

import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import Header from "@/components/header";
import Loader from "@/components/loader";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import React from "react";
import appCss from "~/lib/styles/app.css?url";
import { Footer } from "../components/ui/footer";
export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  theme: string;
}>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
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
      { rel: "stylesheet", href: appCss },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const isFetching = useRouterState({
    select: (s) => s.isLoading,
  });
  return (
    <RootDocument>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <Header />
        {isFetching && <Loader />}
        <Outlet />
        <Footer />
        <Toaster richColors />
      </ThemeProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: { readonly children: React.ReactNode }) {
  React.useEffect(() => {
    if (localStorage.theme === "light") {
      document.documentElement.classList.remove("dark");
    } else if (
      localStorage.theme === "dark" ||
      (!("theme" in localStorage) &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
    ) {
      document.documentElement.classList.add("dark");
    }
  });
  return (
    <html className="supressHydrationWarnings dark">
      <head>
        <HeadContent />
      </head>
      {children}
      <Scripts />
      <TanStackRouterDevtools position="bottom-left" />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
    </html>
  );
}

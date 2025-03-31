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
import React from "react";

export interface RouterAppContext {}

export const Route = createRootRouteWithContext<RouterAppContext>()({
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
        href: "/public/favicon.ico",
      },
    ],
  }),
});
function RootComponent() {
  const isFetching = useRouterState({
    select: (s) => s.isLoading,
  });
  return (
    <>
      <RootDocument>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
          <Header />
          {isFetching && <Loader />}
          <Outlet />
          <Toaster richColors />
        </ThemeProvider>
        <TanStackRouterDevtools position="bottom-left" />
        <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
      </RootDocument>
    </>
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
    // suppress since we're updating the "dark" class in a custom script below suppressHydrationWarning
    <html className="supressHydrationWarnings dark">
      <head>
        <HeadContent />
        <script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

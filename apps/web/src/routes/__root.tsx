// app/routes/__root.tsx

import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import animationsCss from "~/lib/styles/animations.css?url";
import appCss from "~/lib/styles/app.css?url";
import utilsCss from "~/lib/styles/utils.css?url";

import Header from "../lib/components/header";
import { ThemeProvider } from "../lib/components/theme-provider";
import { Footer } from "../lib/components/ui/footer";
import { seo } from "../lib/utils";
export const Route = createRootRouteWithContext<{
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
      ...seo({
        title: "drastic | scale your business with AI",
        description: `drastic is a software development company helping businesses scale their operations with AI-powered solutions.`,
      }),
      {
        rel: "stylesheet",
        href: appCss,
      },

      {
        rel: "stylesheet",
        href: utilsCss,
      },
      {
        rel: "stylesheet",
        href: animationsCss,
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  // const isFetching = useRouterState({
  //   select: (s) => s.isLoading,
  // });
  return (
    <RootDocument>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <Header />
        {/* {isFetching && <Loader />} */}
        <Outlet />
        <Footer />
      </ThemeProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html className="dark" suppressHydrationWarning={true}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

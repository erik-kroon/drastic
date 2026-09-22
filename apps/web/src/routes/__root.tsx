import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";

import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { LinkProvider } from "@open-erp/ui/components/link";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { SiteLink } from "@/components/site-link";
import { seo } from "@/lib/seo";
import { usePageLocale } from "@/lib/use-page-locale";
import { m } from "@/paraglide/messages";
import { baseLocale } from "@/paraglide/runtime";

import "../index.css";

const styles = stylex.create({
  app: {
    backgroundColor: tokens.background,
    color: tokens.foreground,
    minHeight: "100svh",
  },
  content: { outline: "none" },
  skipLink: {
    backgroundColor: tokens.background,
    borderRadius: tokens.radiusMd,
    color: tokens.foreground,
    insetBlockStart: "0.5rem",
    insetInlineStart: "0.5rem",
    outline: "none",
    outlineOffset: 2,
    paddingBlock: tokens.space2,
    paddingInline: tokens.space3,
    position: "fixed",
    transform: "translateY(calc(-100% - 1rem))",
    zIndex: 100,
    ":focus-visible": { boxShadow: tokens.focusRing, transform: "translateY(0)" },
  },
});

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      ...seo({
        title: m.app_title({}, { locale: baseLocale }),
        description: m.seo_description({}, { locale: baseLocale }),
      }),
    ],
  }),
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const locale = usePageLocale();
  return (
    <html lang={locale}>
      <head>
        <HeadContent />
        {import.meta.env.DEV && (
          <>
            <link rel="stylesheet" href="/virtual:stylex.css" suppressHydrationWarning />
            <script type="module" src="/@id/virtual:stylex:runtime" />
          </>
        )}
      </head>
      <body>
        <a href="#main-content" {...stylex.props(styles.skipLink)}>
          {m.skip_to_content({}, { locale })}
        </a>
        <div id="main-content" tabIndex={-1} {...stylex.props([styles.app, styles.content])}>
          <LinkProvider component={SiteLink}>{children}</LinkProvider>
        </div>
        <Scripts />
      </body>
    </html>
  );
}

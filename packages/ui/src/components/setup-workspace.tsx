import type { ComponentProps, ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Button, type ButtonProps } from "@open-erp/ui/components/button";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import type { StyleXStyles } from "@open-erp/ui/lib/stylex";
import { setupLayoutStyles, type SetupLayout } from "@open-erp/ui/components/setup-parts";

const styles = stylex.create({
  workspace: {
    minHeight: "100svh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.workspaceSurface,
    color: tokens.foreground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: tokens.setupTopbarHeight,
    flexShrink: 0,
    paddingInline: tokens.space5,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  brand: { fontWeight: tokens.fontWeightSemibold },
  account: {
    display: "flex",
    alignItems: "center",
    color: tokens.captionForeground,
  },
  content: {
    display: "flex",
    flexDirection: "column",
    alignItems: "start",
    width: tokens.setupWorkspaceWidth,
    paddingBlockStart: tokens.space10,
    paddingInlineStart: tokens.space8,
    gap: tokens.space5,
  },
  focused: { width: tokens.setupFocusedWidth, paddingBlockStart: tokens.space12 },
  title: {
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight20Px,
  },
  caption: {
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
  },
  actions: { display: "flex", alignItems: "center", gap: tokens.space2 },
  button: {
    paddingInline: tokens.space3_5,
    ":focus-visible": {
      outline: tokens.setupControlFocus,
      outlineOffset: 2,
      boxShadow: tokens.shadowNone,
    },
  },
});

export function SetupWorkspace({ account, children }: { account: ReactNode; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.workspace)}>
      <header {...stylex.props(styles.topbar)}>
        <span {...stylex.props(styles.brand)}>Drastic</span>
        <div {...stylex.props(styles.account)}>{account}</div>
      </header>
      {children}
    </div>
  );
}

export function SetupContent({
  focused = false,
  styleX,
  layout,
  ...props
}: Omit<ComponentProps<"form">, "style" | "className"> & {
  focused?: boolean;
  styleX?: StyleXStyles;
  layout?: SetupLayout;
}) {
  return (
    <form
      {...props}
      {...stylex.props(
        styles.content,
        focused && styles.focused,
        styleX,
        setupLayoutStyles(layout),
      )}
    />
  );
}

export function SetupPageContent({
  styleX,
  layout,
  ...props
}: Omit<ComponentProps<"main">, "style" | "className"> & {
  styleX?: StyleXStyles;
  layout?: SetupLayout;
}) {
  return <main {...props} {...stylex.props(styles.content, styleX, setupLayoutStyles(layout))} />;
}

export function SetupTitle(props: ComponentProps<"h1">) {
  return <h1 {...props} {...stylex.props(styles.title)} />;
}

export function SetupCaption(props: ComponentProps<"p">) {
  return <p {...props} {...stylex.props(styles.caption)} />;
}

export function SetupActions({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.actions)}>{children}</div>;
}

export function SetupButton({ styleX, layout, ...props }: ButtonProps & { layout?: SetupLayout }) {
  return (
    <Button
      static
      size="sm"
      {...props}
      styleX={[styles.button, styleX, setupLayoutStyles(layout)]}
    />
  );
}

import { stylexProps, type WithStyleX } from "@open-erp/ui/lib/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type * as React from "react";

const styles = stylex.create({
  root: {
    backgroundColor: tokens.background,
    borderColor: tokens.border,
    borderRadius: tokens.radiusControl,
    borderStyle: "solid",
    borderWidth: 1,
    color: tokens.foreground,
    display: "grid",
    gap: "0.25rem 0.625rem",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    padding: tokens.space3,
    width: "100%",
  },
  info: {
    backgroundColor: tokens.primaryOnBackground6,
    borderColor: tokens.primaryOnBorder24,
  },
  success: {
    backgroundColor: tokens.successOnBackground7,
    borderColor: tokens.successOnBorder28,
  },
  warning: {
    backgroundColor: tokens.warningOnBackground8,
    borderColor: tokens.warningOnBorder30,
  },
  destructive: {
    backgroundColor: tokens.destructiveOnBackground7,
    borderColor: tokens.destructiveOnBorder30,
  },
  icon: {
    alignItems: "center",
    display: "flex",
    gridColumn: "1",
    gridRow: "1 / span 2",
    paddingTop: tokens.space0_25,
  },
  title: {
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
    gridColumn: "2",
    lineHeight: tokens.lineHeightBodyCompact,
    margin: 0,
  },
  description: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    gridColumn: "2",
    lineHeight: tokens.lineHeightNormal,
    margin: 0,
    textWrap: "pretty",
  },
  action: { alignItems: "center", display: "flex", gridColumn: "3", gridRow: "1 / span 2" },
});

type AlertVariant = "default" | "info" | "success" | "warning" | "destructive";

const variantStyles = {
  default: undefined,
  info: styles.info,
  success: styles.success,
  warning: styles.warning,
  destructive: styles.destructive,
} as const;

type AlertProps = WithStyleX<React.ComponentProps<"div">> & { variant?: AlertVariant };

function Alert({ className, role = "alert", styleX, variant = "default", ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role={role}
      {...stylexProps([styles.root, variantStyles[variant], styleX], className)}
      {...props}
    />
  );
}

function AlertIcon({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"div">>) {
  return <div aria-hidden="true" {...stylexProps([styles.icon, styleX], className)} {...props} />;
}

function AlertTitle({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"h3">>) {
  return <h3 {...stylexProps([styles.title, styleX], className)} {...props} />;
}

function AlertDescription({
  className,
  styleX,
  ...props
}: WithStyleX<React.ComponentProps<"div">>) {
  return <div {...stylexProps([styles.description, styleX], className)} {...props} />;
}

function AlertAction({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"div">>) {
  return <div {...stylexProps([styles.action, styleX], className)} {...props} />;
}

export { Alert, AlertAction, AlertDescription, AlertIcon, AlertTitle };

export type { AlertProps, AlertVariant };

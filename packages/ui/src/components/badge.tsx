import { stylexProps, type StyleXStyles, type WithStyleX } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";
import type * as React from "react";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  root: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: tokens.radiusFull,
    borderStyle: "solid",
    borderWidth: 1,
    display: "inline-flex",
    flexShrink: 0,
    fontSize: tokens.fontSizeCompact,
    fontWeight: tokens.fontWeightMedium,
    gap: tokens.space1,
    height: "1.25rem",
    justifyContent: "center",
    overflow: "hidden",
    paddingInline: tokens.space2,
    whiteSpace: "nowrap",
  },
  default: {
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
  },
  secondary: {
    backgroundColor: tokens.secondary,
    color: tokens.secondaryForeground,
  },
  success: {
    backgroundColor: tokens.success,
    borderColor: tokens.successBorder,
    color: tokens.successForeground,
  },
  warning: {
    backgroundColor: tokens.warning,
    borderColor: tokens.warningBorder,
    color: tokens.warningForeground,
  },
  destructive: {
    backgroundColor: tokens.destructiveAlpha10,
    color: tokens.destructive,
  },
  outline: {
    backgroundColor: "transparent",
    borderColor: tokens.border,
    color: tokens.foreground,
  },
});
type BadgeVariant = "default" | "secondary" | "success" | "warning" | "destructive" | "outline";
type BadgeProps = WithStyleX<React.ComponentProps<"span">> & {
  styleX?: StyleXStyles;
  variant?: BadgeVariant;
};
const variants = {
  default: styles.default,
  secondary: styles.secondary,
  success: styles.success,
  warning: styles.warning,
  destructive: styles.destructive,
  outline: styles.outline,
} as const;
function Badge({ className, styleX, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      {...stylexProps([styles.root, variants[variant], styleX], className)}
      {...props}
    />
  );
}
export { Badge };
export type { BadgeProps, BadgeVariant };

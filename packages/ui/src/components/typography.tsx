import type { ComponentProps, ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  text: {
    fontSize: tokens.fontSizeBase,
    lineHeight: tokens.lineHeightNormal,
    overflowWrap: "anywhere",
  },
  muted: { color: tokens.mutedForeground, fontSize: tokens.fontSizeSm },
  title: {
    fontSize: tokens.fontSize3xl,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: tokens.trackingHeading,
    lineHeight: tokens.lineHeightHeading,
    textWrap: "balance",
  },
  heading: {
    fontSize: tokens.fontSizeLg,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHeading,
  },
  metric: {
    fontSize: tokens.fontSize3xl,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: "tabular-nums",
  },
});
export function Text({
  tone = "default",
  ...props
}: ComponentProps<"p"> & { tone?: "default" | "muted" | "metric" }) {
  return (
    <p
      {...props}
      {...stylex.props(
        styles.text,
        tone === "muted" && styles.muted,
        tone === "metric" && styles.metric,
      )}
    />
  );
}
export function Heading({ level = 2, children }: { level?: 1 | 2; children: ReactNode }) {
  return level === 1 ? (
    <h1 {...stylex.props(styles.title)}>{children}</h1>
  ) : (
    <h2 {...stylex.props(styles.heading)}>{children}</h2>
  );
}

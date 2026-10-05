import type { ComponentProps, ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { stylexProps, type WithStyleX } from "@open-erp/ui/lib/stylex";

const styles = stylex.create({
  text: {
    fontSize: tokens.fontSizeSm,
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
    fontSize: tokens.fontSizeBody,
    fontWeight: tokens.fontWeightMedium,
    lineHeight: tokens.lineHeightHeading,
  },
  metric: {
    fontSize: tokens.fontSize3xl,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: "tabular-nums",
  },
  control: { fontSize: tokens.fontSizeControl, lineHeight: tokens.lineHeight16Px },
  caption: {
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
  },
  captionControl: { color: tokens.captionForeground },
  group: {
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeCompact,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight14Px,
    letterSpacing: tokens.trackingGroup,
  },
  metricLarge: { fontSize: tokens.fontSizeDisplaySmall, lineHeight: tokens.lineHeight40Px },
  metricMedium: { fontSize: tokens.fontSizeXl, lineHeight: tokens.lineHeight24Px },
  metricSmall: { fontSize: tokens.fontSizeSm, lineHeight: tokens.lineHeight18Px },
  metricFeatures: { fontFeatureSettings: '"tnum"', fontVariantNumeric: "normal" },
  page: {
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight20Px,
    letterSpacing: tokens.trackingNormal,
    textWrap: "wrap",
  },
  section: {
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight18Px,
  },
  large: {
    fontSize: tokens.fontSizeXl,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight24Px,
    letterSpacing: tokens.trackingNormal,
  },
  semibold: { fontWeight: tokens.fontWeightSemibold },
});

const textVariants = {
  control: styles.control,
  caption: styles.caption,
  group: styles.group,
  metricLarge: styles.metricLarge,
  metricMedium: styles.metricMedium,
  metricSmall: styles.metricSmall,
};

const headingSizes = { page: styles.page, section: styles.section, large: styles.large };

export function Text({
  tone = "default",
  variant,
  as: Element = "p",
  weight,
  ...props
}: ComponentProps<"p"> & {
  tone?: "default" | "muted" | "caption" | "metric";
  variant?: "control" | "caption" | "group" | "metricLarge" | "metricMedium" | "metricSmall";
  as?: "p" | "span";
  weight?: "semibold";
}) {
  return (
    <Element
      {...props}
      {...stylex.props(
        styles.text,
        tone === "muted" && styles.muted,
        tone === "metric" && styles.metric,
        variant && textVariants[variant],
        (variant === "metricLarge" || variant === "metricMedium" || variant === "metricSmall") &&
          styles.metricFeatures,
        tone === "caption" && styles.captionControl,
        weight === "semibold" && styles.semibold,
      )}
    />
  );
}

export function Heading({
  level = 2,
  size,
  children,
  className,
  styleX,
  ...props
}: WithStyleX<ComponentProps<"h1">> & {
  level?: 1 | 2;
  size?: "page" | "section" | "large";
  children: ReactNode;
}) {
  const Element = level === 1 ? "h1" : "h2";

  return (
    <Element
      {...props}
      {...stylexProps(
        [level === 1 ? styles.title : styles.heading, size && headingSizes[size], styleX],
        className,
      )}
    >
      {children}
    </Element>
  );
}

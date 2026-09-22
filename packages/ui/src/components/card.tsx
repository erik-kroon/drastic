import { stylexProps, type WithStyleX } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  card: {
    backgroundColor: tokens.card,
    borderRadius: tokens.radiusSurface,
    boxShadow: tokens.shadowRaised,
    color: tokens.cardForeground,
    display: "flex",
    flexDirection: "column",
    fontSize: tokens.fontSizeXs,
    gap: "var(--card-spacing)",
    lineHeight: tokens.lineHeightRelaxed,
    overflow: "hidden",
    paddingBlock: "var(--card-spacing)",
    position: "relative",
  },
  spacing: (spacing: string) => ({ "--card-spacing": spacing }),
  header: {
    alignItems: "start",
    containerType: "inline-size",
    display: "grid",
    gap: tokens.space1,
    gridAutoRows: "min-content",
    gridTemplateColumns: {
      default: "minmax(0, 1fr)",
      ":has([data-slot='card-action'])": "minmax(0, 1fr) auto",
    },
    gridTemplateRows: {
      default: "auto",
      ":has([data-slot='card-description'])": "auto auto",
    },
    paddingInline: "var(--card-spacing)",
  },
  title: {
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: tokens.trackingCompact,
    lineHeight: tokens.lineHeightHeading,
  },
  description: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeightRelaxed,
  },
  action: {
    alignSelf: "start",
    gridColumnStart: "2",
    gridRow: "1 / span 2",
    justifySelf: "end",
  },
  content: { paddingInline: "var(--card-spacing)" },
  footer: {
    alignItems: "center",
    borderTopColor: tokens.border,
    borderTopStyle: "solid",
    borderTopWidth: 1,
    display: "flex",
    marginBottom: "calc(var(--card-spacing) * -1)",
    padding: "var(--card-spacing)",
  },
});

function Card({
  className,
  size = "default",
  styleX,
  ...props
}: WithStyleX<React.ComponentProps<"div">> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      {...stylexProps(
        [styles.card, styles.spacing(size === "sm" ? "0.75rem" : "1rem"), styleX],
        className,
      )}
      {...props}
    />
  );
}
function CardHeader({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"div">>) {
  return (
    <div data-slot="card-header" {...stylexProps([styles.header, styleX], className)} {...props} />
  );
}
function CardTitle({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"div">>) {
  return (
    <div data-slot="card-title" {...stylexProps([styles.title, styleX], className)} {...props} />
  );
}
function CardDescription({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"div">>) {
  return (
    <div
      data-slot="card-description"
      {...stylexProps([styles.description, styleX], className)}
      {...props}
    />
  );
}
function CardAction({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"div">>) {
  return (
    <div data-slot="card-action" {...stylexProps([styles.action, styleX], className)} {...props} />
  );
}
function CardContent({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"div">>) {
  return (
    <div
      data-slot="card-content"
      {...stylexProps([styles.content, styleX], className)}
      {...props}
    />
  );
}
function CardFooter({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"div">>) {
  return (
    <div data-slot="card-footer" {...stylexProps([styles.footer, styleX], className)} {...props} />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };

import { stylexProps, type WithStyleX } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  root: {
    alignItems: "center",
    borderRadius: 0,
    display: "flex",
    flex: "1",
    flexDirection: "column",
    gap: tokens.space4,
    justifyContent: "center",
    minWidth: 0,
    padding: { default: tokens.space6, "@media (min-width: 768px)": tokens.space12 },
    textAlign: "center",
    textWrap: "balance",
    width: "100%",
  },
  header: {
    alignItems: "center",
    display: "flex",
    flexDirection: "column",
    gap: tokens.space2,
    maxWidth: "24rem",
  },
  media: {
    alignItems: "center",
    display: "flex",
    flexShrink: 0,
    justifyContent: "center",
    marginBottom: tokens.space2,
  },
  mediaDefault: { backgroundColor: "transparent" },
  mediaIcon: {
    backgroundColor: tokens.muted,
    borderRadius: 0,
    color: tokens.foreground,
    height: "2.5rem",
    width: "2.5rem",
  },
  title: {
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightMedium,
    letterSpacing: tokens.trackingHeading,
  },
  description: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeightRelaxed,
  },
  content: {
    alignItems: "center",
    display: "flex",
    flexDirection: "column",
    fontSize: tokens.fontSizeSm,
    gap: tokens.space4,
    maxWidth: "24rem",
    minWidth: 0,
    textWrap: "balance",
    width: "100%",
  },
});

function Empty({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"div">>) {
  return <div data-slot="empty" {...stylexProps([styles.root, styleX], className)} {...props} />;
}

function EmptyHeader({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"div">>) {
  return (
    <div data-slot="empty-header" {...stylexProps([styles.header, styleX], className)} {...props} />
  );
}

function EmptyMedia({
  className,
  variant = "default",
  styleX,
  ...props
}: WithStyleX<React.ComponentProps<"div">> & { variant?: "default" | "icon" }) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      {...stylexProps(
        [styles.media, variant === "icon" ? styles.mediaIcon : styles.mediaDefault, styleX],
        className,
      )}
      {...props}
    />
  );
}

function EmptyTitle({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"div">>) {
  return (
    <div data-slot="empty-title" {...stylexProps([styles.title, styleX], className)} {...props} />
  );
}

function EmptyDescription({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"p">>) {
  return (
    <p
      data-slot="empty-description"
      {...stylexProps([styles.description, styleX], className)}
      {...props}
    />
  );
}

function EmptyContent({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"div">>) {
  return (
    <div
      data-slot="empty-content"
      {...stylexProps([styles.content, styleX], className)}
      {...props}
    />
  );
}

export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia };

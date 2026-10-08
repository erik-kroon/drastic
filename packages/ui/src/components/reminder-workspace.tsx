import { type ReactNode, type HTMLAttributes } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  page: {
    marginInline: tokens.spaceNegative5,
    marginBlockStart: tokens.spaceNegative4,
    minWidth: 0,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    overflowWrap: "anywhere",
  },
  header: {
    minHeight: 48,
    paddingInline: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  trail: { display: "flex", flexWrap: "wrap", gap: 8 },
  metadata: {
    paddingBlock: 10,
    paddingInline: 32,
    color: tokens.mutedForeground,
  },
  split: {
    display: "grid",
    minHeight: "calc(100vh - 84px)",
    gridTemplateColumns: "minmax(0, 1fr) 420px",
    "@media (max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  content: {
    paddingBlock: 24,
    paddingInline: 32,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    minWidth: 0,
  },
  actions: {
    paddingBlock: 24,
    paddingInline: 32,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    minWidth: 0,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.border,
  },
  preparedActions: { gap: 12 },
  stepRow: {
    display: "flex",
    minHeight: 36,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  stepNote: { color: tokens.mutedForeground, lineHeight: tokens.lineHeightReminderNote },
  title: {
    margin: 0,
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeight18Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  pageTitle: {
    margin: 0,
    fontSize: tokens.fontSizeMd,
    lineHeight: tokens.lineHeight20Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  outcomeMetadata: {
    paddingBlock: 10,
    paddingInline: 32,
    color: tokens.foreground,
    fontWeight: tokens.fontWeightSemibold,
  },
  summary: { lineHeight: tokens.lineHeight20Px },
  timelineRow: {
    display: "grid",
    gridTemplateColumns: "120px minmax(0, 1fr)",
    alignItems: "center",
    minHeight: 36,
  },
  card: { overflow: "hidden" },
  row: {
    display: "grid",
    gridTemplateColumns: "80px minmax(0, 1fr)",
    gap: 0,
    minHeight: 34,
    alignItems: "center",
    paddingInline: 16,
  },
  muted: { color: tokens.mutedForeground },
  caption: { color: tokens.mutedForeground, fontSize: tokens.fontSizeXs },
  current: { fontWeight: tokens.fontWeightSemibold },
  subject: { fontWeight: tokens.fontWeightMedium },
  warning: { color: tokens.warningForeground, fontWeight: tokens.fontWeightMedium },
  note: {
    paddingBlock: 0,
    paddingInline: 0,
    color: tokens.mutedForeground,
  },
  body: {
    padding: 16,
    margin: 0,
    whiteSpace: "pre-wrap",
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: tokens.lineHeight21Px,
  },
  attachment: {
    display: "flex",
    gap: 16,
    alignItems: "start",
    padding: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusSurface,
  },
  attachmentDetails: { display: "flex", flexDirection: "column", gap: 4 },
  timeline: {
    margin: 0,
    padding: 0,
    listStyleType: "none",
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
  },
  error: { color: tokens.destructive },
});

export function ReminderWorkspacePart({
  part,
  as: Tag = "div",
  children,
  prepared = false,
  ...props
}: {
  part: keyof typeof styles;
  as?: "section" | "header" | "nav" | "div" | "aside" | "h1" | "h2" | "span" | "pre" | "ol" | "li";
  children?: ReactNode;
  prepared?: boolean;
} & HTMLAttributes<HTMLElement>) {
  return (
    <Tag {...props} {...stylex.props(styles[part], prepared && styles.preparedActions)}>
      {children}
    </Tag>
  );
}

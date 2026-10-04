import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { Link } from "@open-erp/ui/components/link";

const styles = stylex.create({
  body: {
    marginInline: tokens.spaceNegative5,
    minWidth: 0,
    "@media (max-width: 767px)": { marginInline: tokens.spaceNegative4 },
  },
  search: { paddingInline: tokens.space5, paddingBlock: tokens.space2 },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space4,
    minHeight: 48,
    paddingInline: tokens.space5,
    paddingBlock: tokens.space2,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    color: tokens.foreground,
    textDecoration: "none",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    backgroundColor: { default: tokens.card, ":hover": tokens.sidebar },
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRingInset },
  },
  copy: { minWidth: 0 },
  detail: {
    display: "block",
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeXs,
    marginBlockStart: 2,
  },
  action: { color: tokens.primary, flexShrink: 0 },
  footer: { paddingInline: tokens.space5, paddingBlock: tokens.space4 },
});

export function ReportCatalog({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.body)}>{children}</div>;
}

export function ReportCatalogToolbar({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.search)}>{children}</div>;
}

export function ReportCatalogFooter({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.footer)}>{children}</div>;
}

export function ReportCatalogRow(props: {
  href: string;
  title: string;
  detail: string;
  action: string;
}) {
  return (
    <Link href={props.href} {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.copy)}>
        {props.title}
        <span {...stylex.props(styles.detail)}>{props.detail}</span>
      </span>
      <span {...stylex.props(styles.action)}>{props.action}</span>
    </Link>
  );
}

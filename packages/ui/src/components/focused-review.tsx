import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@open-erp/ui/components/link";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  page: { minHeight: "100dvh", backgroundColor: tokens.card, minWidth: 0 },
  header: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: tokens.space3_5,
    minHeight: 48,
    paddingInline: tokens.space4,
    paddingBlock: tokens.space2,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  title: {
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight18Px,
  },
  identity: {
    marginInlineStart: "auto",
    fontSize: tokens.fontSizeControl,
    color: tokens.mutedForeground,
  },
  back: {
    fontSize: tokens.fontSizeControl,
    color: tokens.primary,
    textDecoration: "none",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  body: {
    display: "grid",
    gridTemplateColumns: {
      default: "200px minmax(0, 1fr)",
      "@media (max-width: 767px)": "minmax(0, 1fr)",
    },
    minWidth: 0,
    minHeight: "calc(100dvh - 48px)",
  },
  queue: {
    backgroundColor: tokens.sidebar,
    paddingBlock: tokens.space2_5,
    paddingInline: tokens.space2,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: tokens.border,
    minWidth: 0,
    "@media (max-width: 767px)": {
      borderInlineEndWidth: 0,
      borderBlockEndWidth: 1,
      borderBlockEndStyle: "solid",
      borderBlockEndColor: tokens.border,
    },
  },
  queueLabel: {
    fontSize: tokens.fontSizeCompact,
    lineHeight: tokens.lineHeight14Px,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.mutedForeground,
    padding: tokens.space2,
  },
  row: {
    display: "grid",
    gap: tokens.space1,
    paddingInline: tokens.space2,
    paddingBlock: tokens.space1_5,
    minHeight: 36,
    borderRadius: tokens.radiusControl,
    textDecoration: "none",
    color: tokens.foreground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    overflowWrap: "anywhere",
    ":hover": { backgroundColor: tokens.secondary },
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  active: { backgroundColor: tokens.secondary, fontWeight: tokens.fontWeightSemibold },
  detail: {
    fontSize: tokens.fontSizeXs,
    color: tokens.mutedForeground,
    fontWeight: tokens.fontWeightNormal,
  },
  main: { minWidth: 0 },
});

export function FocusedReview(props: {
  title: string;
  backLabel: string;
  backHref: string;
  identity: string;
  queue: ReactNode;
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <Link href={props.backHref} {...stylex.props(styles.back)}>
          {props.backLabel}
        </Link>
        <h1 {...stylex.props(styles.title)}>{props.title}</h1>
        <span {...stylex.props(styles.identity)}>{props.identity}</span>
      </header>
      <div {...stylex.props(styles.body)}>
        <aside {...stylex.props(styles.queue)}>{props.queue}</aside>
        <div {...stylex.props(styles.main)}>{props.children}</div>
      </div>
    </section>
  );
}

export function ReviewQueueLabel({ children }: { children: ReactNode }) {
  return <h2 {...stylex.props(styles.queueLabel)}>{children}</h2>;
}

export function ReviewQueueItem(props: {
  href: string;
  title: string;
  detail: string;
  active: boolean;
}) {
  return (
    <Link
      href={props.href}
      aria-current={props.active ? "page" : undefined}
      {...stylex.props(styles.row, props.active && styles.active)}
    >
      <span>{props.title}</span>
      <span {...stylex.props(styles.detail)}>{props.detail}</span>
    </Link>
  );
}

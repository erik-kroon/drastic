import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@open-erp/ui/components/link";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { StatusMark, type RegisterStatus } from "@open-erp/ui/components/register-workspace";

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
  focusedTitle: { fontSize: tokens.fontSizeBase, lineHeight: tokens.lineHeight20Px },
  focusedBack: { color: tokens.mutedForeground },
  focusedIdentity: { color: tokens.captionForeground, lineHeight: tokens.lineHeight16Px },
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
  focusedQueue: { display: "flex", flexDirection: "column", gap: 1 },
  queueLabel: {
    fontSize: tokens.fontSizeCompact,
    lineHeight: tokens.lineHeight14Px,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.mutedForeground,
    padding: tokens.space2,
  },
  focusedQueueLabel: { paddingBlock: tokens.space1_5, paddingInline: tokens.space2 },
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
  focusedRow: {
    gridTemplateColumns: "14px minmax(0, 1fr)",
    columnGap: tokens.space2,
    rowGap: 0,
    paddingBlock: tokens.space0_5,
    height: 36,
    position: "relative",
    overflowWrap: "normal",
  },
  focusedActive: {
    fontWeight: tokens.fontWeightMedium,
    "::before": {
      content: '""',
      position: "absolute",
      insetInlineStart: 0,
      insetBlock: 0,
      width: 3,
      backgroundColor: tokens.primary,
      borderRadius: tokens.radiusControl,
    },
  },
  symbol: { gridRow: "1 / 3", alignSelf: "center", color: tokens.primary },
  focusedRowTitle: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
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
  presentation?: "focused";
}) {
  return (
    <section {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <Link
          href={props.backHref}
          {...stylex.props(styles.back, props.presentation === "focused" && styles.focusedBack)}
        >
          {props.backLabel}
        </Link>
        <h1
          {...stylex.props(styles.title, props.presentation === "focused" && styles.focusedTitle)}
        >
          {props.title}
        </h1>
        <span
          {...stylex.props(
            styles.identity,
            props.presentation === "focused" && styles.focusedIdentity,
          )}
        >
          {props.identity}
        </span>
      </header>
      <div {...stylex.props(styles.body)}>
        <aside
          {...stylex.props(styles.queue, props.presentation === "focused" && styles.focusedQueue)}
        >
          {props.queue}
        </aside>
        <div {...stylex.props(styles.main)}>{props.children}</div>
      </div>
    </section>
  );
}

export function ReviewQueueLabel({
  children,
  presentation,
}: {
  children: ReactNode;
  presentation?: "focused";
}) {
  return (
    <h2
      {...stylex.props(styles.queueLabel, presentation === "focused" && styles.focusedQueueLabel)}
    >
      {children}
    </h2>
  );
}

export function ReviewQueueItem(props: {
  href: string;
  title: string;
  detail: string;
  active: boolean;
  presentation?: "focused";
  status?: RegisterStatus;
}) {
  return (
    <Link
      href={props.href}
      aria-current={props.active ? "page" : undefined}
      {...stylex.props(
        styles.row,
        props.active && styles.active,
        props.presentation === "focused" && styles.focusedRow,
        props.presentation === "focused" && props.active && styles.focusedActive,
      )}
    >
      {props.presentation === "focused" && props.status ? (
        <span {...stylex.props(styles.symbol)}>
          <StatusMark status={props.status} />
        </span>
      ) : null}
      <span
        {...stylex.props(props.presentation === "focused" && styles.focusedRowTitle)}
        title={props.title}
      >
        {props.title}
      </span>
      <span {...stylex.props(styles.detail)}>{props.detail}</span>
    </Link>
  );
}

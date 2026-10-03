import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@open-erp/ui/components/link";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  workspace: {
    minWidth: 0,
    minHeight: "100dvh",
    marginInline: tokens.spaceNegative5,
    marginBlockStart: tokens.spaceNegative4,
    marginBlockEnd: tokens.spaceNegative8,
    "@media (max-width: 767px)": { marginInline: tokens.spaceNegative4 },
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: tokens.space4,
    minHeight: 48,
    paddingInline: tokens.space5,
    paddingBlock: tokens.space1_5,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  heading: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: tokens.space4_5 },
  title: {
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeight18Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  balances: {
    display: "flex",
    flexWrap: "wrap",
    gap: 56,
    paddingInline: tokens.space5,
    paddingBlockStart: tokens.space5,
    paddingBlockEnd: tokens.space4,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    "@media (max-width: 767px)": { gap: tokens.space5 },
  },
  caption: {
    display: "block",
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.mutedForeground,
  },
  amount: {
    fontSize: tokens.fontSizeBankBalance,
    lineHeight: tokens.lineHeightBankBalance,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: tokens.trackingSerif,
  },
  warning: { color: tokens.registerWarning },
  inset: { padding: tokens.space5, minWidth: 0 },
  toolbar: {
    minHeight: 40,
    paddingInline: tokens.space5,
    paddingBlock: tokens.space1,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space0,
    minHeight: 40,
    paddingInline: tokens.space5,
    paddingBlock: tokens.space1,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    color: tokens.foreground,
    textDecoration: "none",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    backgroundColor: { default: tokens.transparent, ":hover": tokens.sidebar },
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRingInset },
  },
  needsMatch: { minHeight: 44 },
  date: { width: 70, flexShrink: 0, color: tokens.mutedForeground },
  description: { flex: "1", minWidth: 0, overflowWrap: "anywhere" },
  rowAmount: { width: 110, flexShrink: 0, textAlign: "end", fontVariantNumeric: "tabular-nums" },
});

export function BankWorkspaceLayout(props: {
  title: string;
  tabs: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(styles.workspace)}>
      <header {...stylex.props(styles.header)}>
        <div {...stylex.props(styles.heading)}>
          <h1 {...stylex.props(styles.title)}>{props.title}</h1>
          {props.tabs}
        </div>
        {props.action}
      </header>
      {props.children}
    </section>
  );
}

export function BankBalances({
  facts,
}: {
  facts: readonly { label: string; amount: string; warning?: boolean }[];
}) {
  return (
    <dl {...stylex.props(styles.balances)}>
      {facts.map((fact) => (
        <div key={fact.label} {...stylex.props(fact.warning && styles.warning)}>
          <dt {...stylex.props(styles.caption, fact.warning && styles.warning)}>{fact.label}</dt>
          <dd {...stylex.props(styles.amount)}>{fact.amount}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BankInset({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.inset)}>{children}</div>;
}

export function BankToolbar({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.toolbar)}>{children}</div>;
}

export function BankTransactionRow(props: {
  href: string;
  date: string;
  description: string;
  amount: string;
  caption?: string;
  warning?: boolean;
}) {
  return (
    <Link href={props.href} {...stylex.props(styles.row, props.warning && styles.needsMatch)}>
      <span {...stylex.props(styles.date)}>{props.date}</span>
      <span {...stylex.props(styles.description)}>
        {props.description}
        {props.caption ? (
          <span {...stylex.props(styles.caption, props.warning && styles.warning)}>
            {props.caption}
          </span>
        ) : null}
      </span>
      <span {...stylex.props(styles.rowAmount)}>{props.amount}</span>
    </Link>
  );
}

import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  notice: {
    marginBlockStart: 14,
    marginBlockEnd: 0,
    paddingBlock: 10,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.historicalRefusalBorder,
    borderRadius: tokens.radiusControl,
    backgroundColor: tokens.retainedRefusalBackground,
    color: tokens.historicalRefusalForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight18Px,
  },
  facts: { margin: 0 },
  fact: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    boxSizing: "border-box",
    minHeight: 34,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    ":first-child": {
      borderBlockStartWidth: 1,
      borderBlockStartStyle: "solid",
      borderBlockStartColor: tokens.border,
    },
    ":last-child": { borderBlockEndColor: tokens.border },
  },
  value: { margin: 0, textAlign: "end", fontVariantNumeric: "tabular-nums" },
  emphasis: { fontWeight: tokens.fontWeightSemibold },
  danger: { color: tokens.historicalRefusalForeground, fontWeight: tokens.fontWeightSemibold },
  choice: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    minHeight: 52,
    boxSizing: "border-box",
    paddingBlock: 8,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
    ":first-child": {
      borderBlockStartWidth: 1,
      borderBlockStartStyle: "solid",
      borderBlockStartColor: tokens.border,
    },
    ":last-child": { borderBlockEndColor: tokens.border },
  },
  copy: { flexGrow: 1, minWidth: 0, display: "grid", gap: 2 },
  title: {
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    fontWeight: tokens.fontWeightMedium,
  },
  note: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight18Px,
  },
  action: { flexShrink: 0 },
});

export function PaidRecoveryNotice({ children }: { children: ReactNode }) {
  return (
    <p role="alert" {...stylex.props(styles.notice)}>
      {children}
    </p>
  );
}

export function PaidRecoveryFacts({
  rows,
}: {
  rows: readonly {
    id: string;
    label: string;
    value: ReactNode;
    emphasis?: boolean;
    danger?: boolean;
  }[];
}) {
  return (
    <dl {...stylex.props(styles.facts)}>
      {rows.map((row) => (
        <div key={row.id} {...stylex.props(styles.fact)}>
          <dt {...stylex.props(row.emphasis && styles.emphasis)}>{row.label}</dt>
          <dd
            {...stylex.props(
              styles.value,
              row.emphasis && styles.emphasis,
              row.danger && styles.danger,
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PaidRecoveryChoices({
  rows,
}: {
  rows: readonly { id: string; title: string; note: string; action: ReactNode }[];
}) {
  return (
    <div>
      {rows.map((row) => (
        <div key={row.id} {...stylex.props(styles.choice)}>
          <div {...stylex.props(styles.copy)}>
            <span {...stylex.props(styles.title)}>{row.title}</span>
            <span {...stylex.props(styles.note)}>{row.note}</span>
          </div>
          <div {...stylex.props(styles.action)}>{row.action}</div>
        </div>
      ))}
    </div>
  );
}

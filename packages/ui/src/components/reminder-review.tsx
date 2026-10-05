import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { Link } from "@open-erp/ui/components/link";

const styles = stylex.create({
  alert: {
    marginBlockStart: 14,
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
  table: {
    width: "100%",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  head: {
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
    height: 28,
    backgroundColor: tokens.sidebar,
    borderBlockWidth: 1,
    borderBlockStyle: "solid",
    borderBlockColor: tokens.border,
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
  },
  header: { fontWeight: tokens.fontWeightSemibold, textAlign: "start", padding: 0 },
  label: { width: 200, flexShrink: 0, boxSizing: "border-box", paddingInlineStart: 8 },
  basis: { width: 250, flexShrink: 0, padding: 0 },
  state: { flexGrow: 1, textAlign: "end", paddingInlineEnd: 8, color: tokens.captionForeground },
  row: {
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
    height: 34,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
    ":last-child": { borderBlockEndColor: tokens.border },
  },
  changed: { backgroundColor: tokens.historicalChangedBackground },
  emphasis: { fontWeight: tokens.fontWeightSemibold },
  warning: { color: tokens.registerWarning, fontWeight: tokens.fontWeightSemibold },
  invalid: { color: tokens.historicalRefusalForeground },
  payment: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 34,
    gap: 12,
    borderBlockWidth: 1,
    borderBlockStyle: "solid",
    borderBlockColor: tokens.border,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  paymentLink: { color: tokens.primary },
});

export function ReminderReviewAlert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" {...stylex.props(styles.alert)}>
      {children}
    </div>
  );
}

export function ReminderBasisComparison(props: {
  approvedAt: string;
  checkedAt: string;
  rows: readonly {
    label: string;
    approved: string;
    current: string;
    state: string;
    changed?: boolean;
    invalid?: boolean;
  }[];
}) {
  return (
    <div role="table" {...stylex.props(styles.table)}>
      <div role="rowgroup">
        <div role="row" {...stylex.props(styles.head)}>
          <div role="columnheader" {...stylex.props(styles.header, styles.label)}>
            Uppgift
          </div>
          <div role="columnheader" {...stylex.props(styles.header, styles.basis)}>
            Godkänt {props.approvedAt}
          </div>
          <div role="columnheader" {...stylex.props(styles.header, styles.basis)}>
            Nu {props.checkedAt}
          </div>
          <div role="columnheader" {...stylex.props(styles.header, styles.state)}>
            Läge
          </div>
        </div>
      </div>
      <div role="rowgroup">
        {props.rows.map((row) => (
          <div
            role="row"
            key={row.label}
            {...stylex.props(styles.row, row.changed && styles.changed)}
          >
            <div role="cell" {...stylex.props(styles.label)}>
              {row.label}
            </div>
            <div role="cell" {...stylex.props(styles.basis)}>
              {row.approved}
            </div>
            <div
              role="cell"
              {...stylex.props(
                styles.basis,
                row.changed && styles.emphasis,
                row.invalid && styles.invalid,
              )}
            >
              {row.current}
            </div>
            <div role="cell" {...stylex.props(styles.state, row.changed && styles.warning)}>
              {row.state}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReminderPaymentEvidence({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.payment)}>{children}</div>;
}

export function ReminderPaymentLink({ href }: { href: string }) {
  return (
    <Link href={href} {...stylex.props(styles.paymentLink)}>
      Visa betalningen
    </Link>
  );
}

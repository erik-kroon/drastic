import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(180px, 1fr) 64px 104px 116px 104px 40px",
    gap: 12,
    alignItems: "start",
    minWidth: 0,
  },
  item: {
    paddingBlock: 16,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  header: { paddingBlockEnd: 12, color: tokens.mutedForeground, fontSize: tokens.fontSizeXs },
  cell: { minWidth: 0 },
  numeric: { fontVariantNumeric: "tabular-nums", textAlign: "end" },
  details: { paddingBlockStart: 8 },
  scroll: { overflowX: "auto" },
  content: { minWidth: 680 },
  totals: {
    marginInlineStart: "auto",
    width: "min(100%, 320px)",
    display: "grid",
    gap: 12,
    paddingBlock: 16,
    fontVariantNumeric: "tabular-nums",
  },
  total: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 24,
    fontSize: tokens.fontSizeSm,
  },
  grand: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
    paddingBlockStart: 16,
    marginBlockStart: 4,
    fontSize: tokens.fontSizeLg,
    fontWeight: tokens.fontWeightMedium,
  },
});

export function InvoiceLines({
  labels,
  children,
}: {
  labels: readonly string[];
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.scroll)}>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.row, styles.header)} aria-hidden="true">
          {labels.map((label) => (
            <span key={label}>{label}</span>
          ))}
          <span />
        </div>
        {children}
      </div>
    </div>
  );
}
export function InvoiceLine({
  cells,
  details,
}: {
  cells: readonly ReactNode[];
  details: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.item)}>
      <div {...stylex.props(styles.row)}>
        {cells.map((cell, index) => (
          <div key={index} {...stylex.props(styles.cell, index > 0 && styles.numeric)}>
            {cell}
          </div>
        ))}
      </div>
      <div {...stylex.props(styles.details)}>{details}</div>
    </div>
  );
}
export function InvoiceTotals({
  rows,
}: {
  rows: readonly { label: string; value: string; total?: boolean }[];
}) {
  return (
    <div {...stylex.props(styles.totals)}>
      {rows.map((row) => (
        <div key={row.label} {...stylex.props(styles.total, row.total && styles.grand)}>
          <span>{row.label}</span>
          <span>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
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
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.mutedForeground,
  },
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
  label: { flexGrow: 1, minWidth: 0, paddingInlineStart: 8 },
  number: {
    width: 140,
    flexShrink: 0,
    textAlign: "end",
    boxSizing: "border-box",
    fontVariantNumeric: "tabular-nums",
  },
  revised: { fontWeight: tokens.fontWeightSemibold },
  difference: { paddingInlineEnd: 8 },
  facts: { margin: 0 },
  fact: {
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
    minHeight: 32,
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
  factLabel: { width: 240, flexShrink: 0 },
  factValue: { margin: 0, minWidth: 0 },
});

export function MileageCorrectionComparison({
  rows,
}: {
  rows: readonly {
    id: string;
    label: string;
    original: string;
    revised: string;
    difference: string;
  }[];
}) {
  return (
    <div role="table" aria-label="Rättelsen" {...stylex.props(styles.table)}>
      <div role="rowgroup">
        <div role="row" {...stylex.props(styles.head)}>
          <span role="columnheader" {...stylex.props(styles.label)}>
            Del
          </span>
          <span role="columnheader" {...stylex.props(styles.number)}>
            Ursprunglig
          </span>
          <span role="columnheader" {...stylex.props(styles.number)}>
            Rättad
          </span>
          <span role="columnheader" {...stylex.props(styles.number, styles.difference)}>
            Skillnad
          </span>
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((row) => (
          <div key={row.id} role="row" {...stylex.props(styles.row)}>
            <span role="rowheader" {...stylex.props(styles.label)}>
              {row.label}
            </span>
            <span role="cell" {...stylex.props(styles.number)}>
              {row.original}
            </span>
            <span role="cell" {...stylex.props(styles.number, styles.revised)}>
              {row.revised}
            </span>
            <span role="cell" {...stylex.props(styles.number, styles.difference)}>
              {row.difference}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MileageCorrectionFacts({
  rows,
}: {
  rows: readonly { id: string; label: string; value: ReactNode }[];
}) {
  return (
    <dl {...stylex.props(styles.facts)}>
      {rows.map((row) => (
        <div key={row.id} {...stylex.props(styles.fact)}>
          <dt {...stylex.props(styles.factLabel)}>{row.label}</dt>
          <dd {...stylex.props(styles.factValue)}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

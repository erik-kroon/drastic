import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  table: { width: "100%" },
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
    lineHeight: tokens.lineHeight16Px,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.mutedForeground,
  },
  row: {
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
    minHeight: 52,
    paddingBlock: 8,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight18Px,
    ":last-child": { borderBlockEndColor: tokens.border },
  },
  reason: { width: 340, flexShrink: 0, paddingInlineStart: 8, boxSizing: "border-box" },
  known: { flexGrow: 1, minWidth: 0, paddingInlineEnd: 16, color: tokens.mutedForeground },
  action: {
    width: 110,
    flexShrink: 0,
    paddingInlineEnd: 8,
    textAlign: "end",
    boxSizing: "border-box",
  },
  facts: { margin: 0 },
  fact: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    boxSizing: "border-box",
    minHeight: 32,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
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
  value: { margin: 0, fontVariantNumeric: "tabular-nums" },
  unknown: { color: tokens.warningForeground, fontWeight: tokens.fontWeightSemibold },
});

export function VariablePayBlockers({
  rows,
}: {
  rows: readonly { id: string; reason: string; known: string; action: ReactNode }[];
}) {
  return (
    <div role="table" aria-label="Stoppar godkännandet" {...stylex.props(styles.table)}>
      <div role="rowgroup">
        <div role="row" {...stylex.props(styles.head)}>
          <span role="columnheader" {...stylex.props(styles.reason)}>
            Orsak
          </span>
          <span role="columnheader" {...stylex.props(styles.known)}>
            Vad som är känt
          </span>
          <span role="columnheader" {...stylex.props(styles.action)}>
            Visa
          </span>
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((row) => (
          <div key={row.id} role="row" {...stylex.props(styles.row)}>
            <span role="rowheader" {...stylex.props(styles.reason)}>
              {row.reason}
            </span>
            <span role="cell" {...stylex.props(styles.known)}>
              {row.known}
            </span>
            <span role="cell" {...stylex.props(styles.action)}>
              {row.action}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function VariablePayPartialAmounts({
  rows,
}: {
  rows: readonly { id: string; label: string; value: string | null }[];
}) {
  return (
    <dl {...stylex.props(styles.facts)}>
      {rows.map((row) => (
        <div key={row.id} {...stylex.props(styles.fact)}>
          <dt>{row.label}</dt>
          <dd {...stylex.props(styles.value, row.value === null && styles.unknown)}>
            {row.value ?? "Okänd"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

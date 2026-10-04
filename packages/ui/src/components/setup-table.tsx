import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  table: (width: string) => ({ display: "flex", flexDirection: "column", width, flexShrink: 0 }),
  row: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    height: tokens.setupTableRowHeight,
    paddingInline: tokens.space2,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  sourceRow: { height: tokens.setupSourceRowHeight },
  compactRow: { height: tokens.controlHeightLg },
  header: {
    height: tokens.controlHeight,
    backgroundColor: tokens.sidebar,
    borderBlockEndWidth: 0,
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
  },
  cell: (width: string, numeric: boolean) => ({
    width,
    flexShrink: 0,
    textAlign: numeric ? "end" : "start",
    fontVariantNumeric: numeric ? "tabular-nums" : "normal",
  }),
  selected: { backgroundColor: tokens.registerSelected, boxShadow: tokens.selectionIndicator },
  warning: { backgroundColor: tokens.warning },
  blocked: { backgroundColor: tokens.destructiveBackground },
});

export function SetupTable({
  title,
  width,
  columns,
  rows,
  density = "standard",
}: {
  title: string;
  width: string;
  columns: readonly { id: string; label: string; width: string; numeric?: boolean }[];
  rows: readonly {
    id: string;
    cells: readonly ReactNode[];
    tone?: "selected" | "warning" | "blocked";
  }[];
  density?: "standard" | "source" | "compact";
}) {
  return (
    <div role="table" aria-label={title} {...stylex.props(styles.table(width))}>
      <div role="rowgroup">
        <div role="row" {...stylex.props(styles.row, styles.header)}>
          {columns.map((column) => (
            <div
              key={column.id}
              role="columnheader"
              {...stylex.props(styles.cell(column.width, column.numeric ?? false))}
            >
              {column.label}
            </div>
          ))}
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((row) => (
          <div
            key={row.id}
            role="row"
            aria-selected={row.tone === "selected" ? true : undefined}
            {...stylex.props(
              styles.row,
              density === "source" && styles.sourceRow,
              density === "compact" && styles.compactRow,
              row.tone === "selected" && styles.selected,
              row.tone === "warning" && styles.warning,
              row.tone === "blocked" && styles.blocked,
            )}
          >
            {columns.map((column, index) => (
              <div
                key={column.id}
                role="cell"
                {...stylex.props(styles.cell(column.width, column.numeric ?? false))}
              >
                {row.cells[index]}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

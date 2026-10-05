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
  openingRow: { paddingInline: 0 },
  deltaRow: { paddingInline: 0, height: tokens.controlHeightIconLg },
  deltaLastCell: { paddingInlineStart: tokens.space6 },
  firstOpeningCell: { paddingInlineStart: tokens.space2 },
  lastOpeningCell: { paddingInlineStart: tokens.space4 },
  group: {
    height: tokens.controlHeightSm,
    paddingInline: tokens.space2,
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeCompact,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: tokens.trackingGroup,
  },
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
  descriptionRow: {
    height: "auto",
    flexDirection: "column",
    alignItems: "stretch",
    paddingBlock: tokens.space2,
    gap: tokens.space0_5,
  },
  cells: { display: "contents" },
  descriptionCells: { display: "flex", alignItems: "center", height: tokens.controlHeightSm },
});

export function SetupTable({
  title,
  width,
  columns,
  rows,
  density = "standard",
  layout,
}: {
  title: string;
  width: string;
  columns: readonly { id: string; label: string; width: string; numeric?: boolean }[];
  rows: readonly {
    id: string;
    cells: readonly ReactNode[];
    tone?: "selected" | "warning" | "blocked";
    group?: string;
    description?: ReactNode;
  }[];
  density?: "standard" | "source" | "compact";
  layout?: "opening" | "delta";
}) {
  return (
    <div role="table" aria-label={title} {...stylex.props(styles.table(width))}>
      <div role="rowgroup">
        <div role="row" {...stylex.props(styles.row, styles.header, !!layout && styles.openingRow)}>
          {columns.map((column, index) => (
            <div
              key={column.id}
              role="columnheader"
              {...stylex.props(
                styles.cell(column.width, column.numeric ?? false),
                !!layout && index === 0 && styles.firstOpeningCell,
                layout === "opening" && index === columns.length - 1 && styles.lastOpeningCell,
                layout === "delta" && index === columns.length - 1 && styles.deltaLastCell,
              )}
            >
              {column.label}
            </div>
          ))}
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((row) =>
          row.group ? (
            <div key={row.id} role="row" {...stylex.props(styles.row, styles.group)}>
              <div role="cell" aria-colspan={columns.length}>
                {row.group}
              </div>
            </div>
          ) : (
            <div
              key={row.id}
              role="row"
              aria-selected={row.tone === "selected" ? true : undefined}
              {...stylex.props(
                styles.row,
                row.description !== undefined && styles.descriptionRow,
                layout === "opening" && styles.openingRow,
                density === "source" && styles.sourceRow,
                density === "compact" && styles.compactRow,
                layout === "delta" && styles.deltaRow,
                row.tone === "selected" && styles.selected,
                row.tone === "warning" && styles.warning,
                row.tone === "blocked" && styles.blocked,
                row.description !== undefined && styles.descriptionRow,
              )}
            >
              <div
                {...stylex.props(
                  styles.cells,
                  row.description !== undefined && styles.descriptionCells,
                )}
              >
                {columns.map((column, index) => (
                  <div
                    key={column.id}
                    role="cell"
                    {...stylex.props(
                      styles.cell(column.width, column.numeric ?? false),
                      !!layout && index === 0 && styles.firstOpeningCell,
                      layout === "opening" &&
                        index === columns.length - 1 &&
                        styles.lastOpeningCell,
                      layout === "delta" && index === columns.length - 1 && styles.deltaLastCell,
                    )}
                  >
                    {row.cells[index]}
                  </div>
                ))}
              </div>
              {row.description}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

"use client";

import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import * as stylex from "@stylexjs/stylex";
import { Fragment, type ReactNode } from "react";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const features = tableFeatures({});

const styles = stylex.create({
  scroll: {
    minWidth: 0,
    containerType: "inline-size",
    overflowX: "auto",
    outline: "none",
    ":focus-visible": { boxShadow: tokens.focusRing },
  },
  table: { borderCollapse: "collapse", width: "100%", fontSize: tokens.fontSizeControl },
  registerTable: {
    lineHeight: tokens.lineHeight16Px,
    borderCollapse: "separate",
    borderSpacing: 0,
  },
  wide: { minWidth: "36rem" },
  expanded: { minWidth: "56rem" },
  stackedTable: { "@container (max-width: 36rem)": { display: "block", minWidth: 0 } },
  stackedBody: { "@container (max-width: 36rem)": { display: "block" } },
  stackedHeader: {
    "@container (max-width: 36rem)": {
      position: "absolute",
      width: 1,
      height: 1,
      overflow: "hidden",
      clipPath: "inset(50%)",
    },
  },
  stackedRow: {
    "@container (max-width: 36rem)": {
      display: "grid",
      paddingBlock: tokens.space3,
      borderBottomWidth: 1,
      borderBottomStyle: "solid",
      borderBottomColor: tokens.border,
    },
  },
  stackedCell: {
    "@container (max-width: 36rem)": {
      display: "grid",
      gridTemplateColumns: "minmax(6rem, 0.8fr) minmax(0, 1.4fr)",
      gap: tokens.space3,
      padding: tokens.space2,
      borderBottomWidth: 0,
      textAlign: "start",
      paddingInlineStart: tokens.space3,
    },
  },
  mobileLabel: {
    display: { default: "none", "@container (max-width: 36rem)": "block" },
    color: tokens.mutedForeground,
    fontWeight: tokens.fontWeightMedium,
  },
  value: { minWidth: 0 },
  detail: {
    padding: tokens.space4,
    backgroundColor: tokens.background,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    textAlign: "start",
    overflowWrap: "anywhere",
  },
  stackedDetail: { "@container (max-width: 36rem)": { display: "block" } },
  header: { backgroundColor: tokens.sidebar, position: "sticky", top: 0, zIndex: 1 },
  headerCell: {
    height: 30,
    paddingBlock: tokens.space1,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.mutedForeground,
  },
  cell: {
    textAlign: "start",
    borderBottomColor: tokens.border,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    height: 40,
    paddingBlock: tokens.space1,
    paddingInlineEnd: tokens.space4,
    ":first-child": { paddingInlineStart: tokens.space5 },
    overflowWrap: "anywhere",
    verticalAlign: "middle",
  },
  row: { ":hover": { backgroundColor: tokens.sidebar } },
  registerCell: {
    paddingInlineEnd: 0,
    borderBottomColor: tokens.rowDivider,
    ":last-child": { paddingInlineEnd: tokens.space5 },
  },
  registerHeaderCell: { borderBottomColor: tokens.border },
  insetColumn: { paddingInlineStart: tokens.space6 },
  contentColumn: {
    width: 1,
    whiteSpace: "nowrap",
    "@container (max-width: 36rem)": { width: "auto", whiteSpace: "normal" },
  },
  fillColumn: { width: "100%" },
  fixedColumn: (width: number | undefined) => ({
    width,
    minWidth: width,
    "@container (max-width: 36rem)": { width: "auto", minWidth: 0 },
  }),
  numeric: { textAlign: "end", fontVariantNumeric: "tabular-nums" },
});

export interface DataGridColumn<Row> {
  id: string;
  label: string;
  cell: (row: Row) => ReactNode;
  numeric?: boolean;
  width?: "content" | "fill" | number;
  inset?: boolean;
}

/** Read-only adaptation of the 2.0 grid. The caller owns server filters and cursor pagination. */
export function DataGrid<Row extends object>({
  title,
  columns,
  rows,
  getRowId,
  busy = false,
  narrow = "scroll",
  minWidth = "standard",
  renderDetail,
  presentation = "table",
}: {
  title: string;
  columns: readonly DataGridColumn<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  busy?: boolean;
  narrow?: "scroll" | "stack";
  minWidth?: "standard" | "wide" | "fit";
  renderDetail?: (row: Row) => ReactNode;
  presentation?: "table" | "register";
}) {
  const column = createColumnHelper<typeof features, Row>();

  function columnWidth(index: number) {
    const width = columns[index]?.width;

    if (typeof width !== "number") return undefined;

    return width + (presentation === "register" && index === columns.length - 1 ? 20 : 0);
  }

  const table = useTable({
    features,
    data: [...rows],
    getRowId,
    columns: column.columns(
      columns.map((item) =>
        column.display({
          id: item.id,
          header: item.label,
          cell: (context) => item.cell(context.row.original),
        }),
      ),
    ),
  });

  return (
    <div
      {...stylex.props(styles.scroll)}
      role="region"
      aria-label={title}
      tabIndex={0}
      aria-busy={busy}
    >
      <table
        {...stylex.props(
          styles.table,
          presentation === "register" && styles.registerTable,
          columns.length > 2 && minWidth !== "fit" && styles.wide,
          minWidth === "wide" && styles.expanded,
          narrow === "stack" && styles.stackedTable,
        )}
        aria-label={title}
        role="table"
      >
        <thead
          {...stylex.props(styles.header, narrow === "stack" && styles.stackedHeader)}
          role="rowgroup"
        >
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} role="row">
              {group.headers.map((header, index) => (
                <th
                  key={header.id}
                  scope="col"
                  role="columnheader"
                  {...stylex.props(
                    styles.cell,
                    styles.headerCell,
                    presentation === "register" && styles.registerCell,
                    presentation === "register" && styles.registerHeaderCell,
                    columns[index]?.width === "content" && styles.contentColumn,
                    columns[index]?.width === "fill" && styles.fillColumn,
                    typeof columns[index]?.width === "number" &&
                      styles.fixedColumn(columnWidth(index)),
                    columns[index]?.numeric && styles.numeric,
                    columns[index]?.inset && styles.insetColumn,
                  )}
                >
                  <table.FlexRender header={header} />
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody {...stylex.props(narrow === "stack" && styles.stackedBody)} role="rowgroup">
          {table.getRowModel().rows.map((row) => {
            const detail = renderDetail?.(row.original);

            return (
              <Fragment key={row.id}>
                <tr
                  {...stylex.props(styles.row, narrow === "stack" && styles.stackedRow)}
                  role="row"
                >
                  {row.getAllCells().map((cell, index) => (
                    <td
                      key={cell.id}
                      role="cell"
                      {...stylex.props(
                        styles.cell,
                        presentation === "register" && styles.registerCell,
                        columns[index]?.width === "content" && styles.contentColumn,
                        columns[index]?.width === "fill" && styles.fillColumn,
                        typeof columns[index]?.width === "number" &&
                          styles.fixedColumn(columnWidth(index)),
                        columns[index]?.numeric && styles.numeric,
                        columns[index]?.inset && styles.insetColumn,
                        narrow === "stack" && styles.stackedCell,
                      )}
                    >
                      {narrow === "stack" && (
                        <span aria-hidden="true" {...stylex.props(styles.mobileLabel)}>
                          {columns[index]?.label}
                        </span>
                      )}
                      <div {...stylex.props(styles.value)}>
                        {columns[index]?.cell(row.original)}
                      </div>
                    </td>
                  ))}
                </tr>
                {detail && (
                  <tr role="row" {...stylex.props(narrow === "stack" && styles.stackedDetail)}>
                    <td
                      role="cell"
                      colSpan={columns.length}
                      {...stylex.props(styles.detail, narrow === "stack" && styles.stackedDetail)}
                    >
                      {detail}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

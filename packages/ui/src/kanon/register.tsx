import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { kanon } from "@open-erp/ui/theme/kanon.stylex";

const styles = stylex.create({
  search: {
    paddingInline: kanon.space8,
    display: "flex",
    alignItems: "center",
    height: kanon.sizeRow,
    boxSizing: "border-box",
    borderBottomColor: kanon.colorRule,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
  },
  input: {
    appearance: "none",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: kanon.colorText,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
    width: "100%",
    ":focus-visible": { outline: "none", boxShadow: kanon.shadowFocus },
  },
  scroll: { overflowX: "auto", minWidth: 0, maxWidth: "100%", width: "100%" },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
    fontFamily: kanon.fontUi,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
  },
  cell: {
    paddingBlock: 0,
    height: kanon.sizeRow,
    boxSizing: "border-box",
    paddingInline: 0,
    textAlign: "start",
    borderBottomColor: kanon.colorRule,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    overflowWrap: "anywhere",
    color: kanon.colorText,
    verticalAlign: "middle",
  },
  heading: {
    color: kanon.colorSecondary,
    fontSize: kanon.textCaption,
    fontWeight: kanon.weightRegular,
  },
  numeric: { textAlign: "end", fontVariantNumeric: "tabular-nums" },
  selected: { backgroundColor: kanon.colorSelectedRow },
  gutter: {
    width: kanon.space8,
    padding: 0,
    borderBottomColor: kanon.colorRule,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
  },
  quoteTitle: { width: kanon.sizeQuoteTitleColumn },
  amount: { width: kanon.sizeAmountColumn },
  state: { width: kanon.sizeAmountColumn },
  stateInset: { paddingInlineStart: kanon.space6 },
  unit: { width: kanon.sizeUnitColumn },
  tax: { width: kanon.sizeTaxColumn },
  price: { width: kanon.sizePriceColumn },
  account: { width: kanon.sizeLabelColumn },
  interval: { width: kanon.sizeIntervalColumn },
  date: { width: kanon.sizeStartColumn },
});

export function RegisterSearch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div {...stylex.props(styles.search)}>
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        {...stylex.props(styles.input)}
      />
    </div>
  );
}

export function RegisterTable({
  label,
  columns,
  rows,
  selected,
}: {
  label: string;
  columns: readonly {
    label: string;
    numeric?: boolean;
    width?:
      | "interval"
      | "date"
      | "unit"
      | "tax"
      | "price"
      | "account"
      | "quoteTitle"
      | "amount"
      | "state";
  }[];
  rows: readonly { id: string; cells: readonly ReactNode[] }[];
  selected?: string;
}) {
  return (
    <div tabIndex={0} role="region" aria-label={label} {...stylex.props(styles.scroll)}>
      <table aria-label={label} {...stylex.props(styles.table)}>
        <colgroup>
          <col {...stylex.props(styles.gutter)} />
          {columns.map((column) => (
            <col key={column.label} {...stylex.props(column.width && styles[column.width])} />
          ))}
          <col {...stylex.props(styles.gutter)} />
        </colgroup>
        <thead>
          <tr>
            <th aria-hidden="true" {...stylex.props(styles.gutter)} />
            {columns.map((column) => (
              <th
                key={column.label}
                scope="col"
                {...stylex.props(
                  styles.cell,
                  styles.heading,
                  column.numeric && styles.numeric,
                  column.width === "state" && styles.stateInset,
                )}
              >
                {column.label}
              </th>
            ))}
            <th aria-hidden="true" {...stylex.props(styles.gutter)} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} {...stylex.props(row.id === selected && styles.selected)}>
              <td aria-hidden="true" {...stylex.props(styles.gutter)} />
              {row.cells.map((cell, index) => (
                <td
                  key={columns[index]?.label ?? String(index)}
                  {...stylex.props(
                    styles.cell,
                    columns[index]?.numeric && styles.numeric,
                    columns[index]?.width === "state" && styles.stateInset,
                  )}
                >
                  {cell}
                </td>
              ))}
              <td aria-hidden="true" {...stylex.props(styles.gutter)} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

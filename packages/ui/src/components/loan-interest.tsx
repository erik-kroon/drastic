import { Button } from "@open-erp/ui/components/button";
import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  evidenceButton: {
    color: tokens.primary,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    textAlign: "left",
    ":focus-visible": {
      outlineWidth: 2,
      outlineStyle: "solid",
      outlineColor: tokens.primary,
      outlineOffset: 2,
    },
  },
  table: {
    width: "100%",
    tableLayout: "fixed",
    borderCollapse: "collapse",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  head: {
    backgroundColor: tokens.sidebar,
    color: tokens.mutedForeground,
    height: 27,
    fontSize: tokens.fontSizeXs,
    borderBlockWidth: 1,
    borderBlockStyle: "solid",
    borderBlockColor: tokens.border,
  },
  header: { fontWeight: tokens.fontWeightSemibold, padding: 0, textAlign: "left" },
  row: {
    height: 32,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
  },
  first: { paddingInlineStart: 8 },
  last: { paddingInlineEnd: 8 },
  rateDate: { width: 130 },
  rateValue: { width: 100 },
  from: { width: 110 },
  to: { width: 130 },
  days: { width: 80 },
  principal: { width: 150 },
  interest: { width: 90 },
  numeric: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
  selected: { backgroundColor: tokens.sourceSelected },
  hint: { textAlign: "right", fontSize: tokens.fontSizeXs, color: tokens.mutedForeground },
  warning: {
    marginBlockStart: 14,
    marginBlockEnd: 0,
    paddingBlock: 10,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.loanWarningBorder,
    borderRadius: tokens.radiusControl,
    backgroundColor: tokens.loanWarningBackground,
    color: tokens.registerWarning,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight18Px,
  },
  summary: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 32,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    paddingInline: 8,
  },
  strong: { fontWeight: tokens.fontWeightSemibold, borderBlockEndColor: tokens.border },
});

export function LoanRateTable({
  rows,
}: {
  rows: readonly {
    id: string;
    date: string;
    rate: string;
    evidence: ReactNode;
    backdated: boolean;
  }[];
}) {
  return (
    <table {...stylex.props(styles.table)}>
      <thead {...stylex.props(styles.head)}>
        <tr>
          <th {...stylex.props(styles.header, styles.first, styles.rateDate)}>Gäller från</th>
          <th {...stylex.props(styles.header, styles.rateValue)}>Ränta</th>
          <th {...stylex.props(styles.header)}>Underlag</th>
          <th
            aria-label="Ränteändring"
            {...stylex.props(styles.header, styles.hint, styles.last)}
          />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} {...stylex.props(styles.row, row.backdated && styles.selected)}>
            <td {...stylex.props(styles.first)}>{row.date}</td>
            <td>{row.rate}</td>
            <td>{row.evidence}</td>
            <td {...stylex.props(styles.hint, styles.last)}>
              {row.backdated ? "Ny, gäller bakåt i tiden" : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LoanSegmentTable({
  rows,
}: {
  rows: readonly {
    id: string;
    from: string;
    through: string;
    days: string;
    principal: string;
    rate: string;
    exact: string;
  }[];
}) {
  return (
    <table {...stylex.props(styles.table)}>
      <thead {...stylex.props(styles.head)}>
        <tr>
          <th {...stylex.props(styles.header, styles.first, styles.from)}>Från</th>
          <th {...stylex.props(styles.header, styles.to)}>Till och med</th>
          <th {...stylex.props(styles.header, styles.days, styles.numeric)}>Dagar</th>
          <th {...stylex.props(styles.header, styles.principal, styles.numeric)}>Kapital</th>
          <th {...stylex.props(styles.header, styles.interest, styles.numeric)}>Ränta</th>
          <th {...stylex.props(styles.header, styles.last, styles.numeric)}>
            Ränta före avrundning
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} {...stylex.props(styles.row)}>
            <td {...stylex.props(styles.first)}>{row.from}</td>
            <td>{row.through}</td>
            <td {...stylex.props(styles.numeric)}>{row.days}</td>
            <td {...stylex.props(styles.numeric)}>{row.principal}</td>
            <td {...stylex.props(styles.numeric)}>{row.rate}</td>
            <td {...stylex.props(styles.numeric, styles.last)}>{row.exact}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LoanCalculationFact({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div {...stylex.props(styles.summary, emphasis && styles.strong)}>
      <span>{label}</span>
      <span {...stylex.props(styles.numeric)}>{value}</span>
    </div>
  );
}

export function LoanCoverageWarning({ children }: { children: ReactNode }) {
  return (
    <p role="note" {...stylex.props(styles.warning)}>
      {children}
    </p>
  );
}

export function LoanEvidenceButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button variant="unstyled" styleX={styles.evidenceButton} onClick={onClick}>
      {children}
    </Button>
  );
}

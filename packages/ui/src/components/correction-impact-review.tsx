import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

export type CorrectionImpactAmountRow = {
  id: string;
  account: string;
  amounts: readonly [string, string, string];
  deltaTone?: "changed" | "muted";
  emphasized?: boolean;
};

const styles = stylex.create({
  label: {
    marginBlockStart: 18,
    marginBlockEnd: tokens.space1_5,
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  scroll: { overflowX: "auto" },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    tableLayout: "fixed",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  header: {
    height: 28,
    backgroundColor: tokens.sidebar,
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
  },
  headerCell: {
    borderBlockStartWidth: 1,
    borderBlockEndWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockEndStyle: "solid",
    borderColor: tokens.border,
  },
  account: {
    padding: 0,
    paddingInlineStart: tokens.space2,
    textAlign: "start",
    fontWeight: tokens.fontWeightNormal,
  },
  headerAccount: { fontWeight: tokens.fontWeightSemibold },
  amount: { width: 110, textAlign: "end", padding: 0 },
  vatAmount: { width: 130 },
  delta: { width: 100, paddingInlineEnd: tokens.space2 },
  row: {
    height: 28,
  },
  rowCell: {
    verticalAlign: "top",
    paddingBlockStart: 5,
    paddingBlockEnd: 6,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.ghostHoverBackground,
  },
  lastRow: { borderBlockEndColor: tokens.border },
  total: { fontWeight: tokens.fontWeightSemibold },
  changed: { color: tokens.warningForeground, fontWeight: tokens.fontWeightSemibold },
  zero: { color: tokens.captionForeground },
  note: {
    marginBlockStart: tokens.space1_5,
    marginBlockEnd: 0,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight18Px,
    color: tokens.mutedForeground,
  },
  choice: {
    display: "flex",
    alignItems: "start",
    gap: tokens.space2_5,
    paddingBlock: tokens.space2_5,
    paddingInline: tokens.space3,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.primary,
    borderRadius: tokens.radiusControl,
    backgroundColor: tokens.sourceSelected,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  blockedChoice: {
    marginBlockStart: tokens.space1_5,
    paddingBlock: tokens.space2,
    borderColor: tokens.border,
    backgroundColor: tokens.transparent,
    color: tokens.captionForeground,
  },
  choiceMark: {
    width: 14,
    height: 14,
    marginBlockStart: tokens.space0_5,
    flexShrink: 0,
    borderRadius: tokens.radiusFull,
    borderWidth: 4,
    borderStyle: "solid",
    borderColor: tokens.primary,
    backgroundColor: tokens.card,
  },
  blockedMark: {
    borderWidth: 1.5,
    borderColor: tokens.registerDraft,
    backgroundColor: tokens.transparent,
  },
  choiceTitle: { fontWeight: tokens.fontWeightMedium },
  choiceDetail: {
    marginBlockStart: tokens.space0_5,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.mutedForeground,
  },
  blockedDetail: { color: tokens.captionForeground },
});

const deltaTones = { changed: styles.changed, muted: styles.zero };

export function CorrectionImpactAmountTable(props: {
  title: string;
  accountLabel: string;
  columns: readonly [string, string, string];
  rows: readonly CorrectionImpactAmountRow[];
  amountWidth?: "compact" | "wide";
}) {
  return (
    <>
      <h2 {...stylex.props(styles.label)}>{props.title}</h2>
      <div {...stylex.props(styles.scroll)}>
        <table aria-label={props.title} {...stylex.props(styles.table)}>
          <thead>
            <tr {...stylex.props(styles.header)}>
              <th
                scope="col"
                {...stylex.props(styles.account, styles.headerAccount, styles.headerCell)}
              >
                {props.accountLabel}
              </th>
              {props.columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  {...stylex.props(
                    styles.amount,
                    styles.headerCell,
                    props.amountWidth === "wide" && styles.vatAmount,
                    index === 2 && styles.delta,
                  )}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row, index) => (
              <ImpactAmountRow
                key={row.id}
                row={row}
                wide={props.amountWidth === "wide"}
                last={index === props.rows.length - 1}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ImpactAmountRow({
  row,
  wide,
  last,
}: {
  row: CorrectionImpactAmountRow;
  wide: boolean;
  last: boolean;
}) {
  return (
    <tr {...stylex.props(styles.row, row.emphasized && styles.total)}>
      <th
        scope="row"
        {...stylex.props(
          styles.account,
          styles.rowCell,
          last && styles.lastRow,
          row.emphasized && styles.total,
        )}
      >
        {row.account}
      </th>
      {row.amounts.map((amount, column) => (
        <td
          key={column}
          {...stylex.props(
            styles.amount,
            styles.rowCell,
            last && styles.lastRow,
            wide && styles.vatAmount,
            column === 2 && styles.delta,
            column === 2 && row.deltaTone && deltaTones[row.deltaTone],
          )}
        >
          {amount}
        </td>
      ))}
    </tr>
  );
}

export function CorrectionImpactNote({ children }: { children: ReactNode }) {
  return <p {...stylex.props(styles.note)}>{children}</p>;
}

export function CorrectionImpactOptions(props: {
  title: string;
  selected: { title: string; detail: string };
  blocked: { title: string; detail: string };
}) {
  return (
    <section aria-label={props.title}>
      <h2 {...stylex.props(styles.label)}>{props.title}</h2>
      <div {...stylex.props(styles.choice)}>
        <span aria-hidden="true" {...stylex.props(styles.choiceMark)} />
        <div>
          <p {...stylex.props(styles.choiceTitle)}>{props.selected.title}</p>
          <p {...stylex.props(styles.choiceDetail)}>{props.selected.detail}</p>
        </div>
      </div>
      <div {...stylex.props(styles.choice, styles.blockedChoice)}>
        <span aria-hidden="true" {...stylex.props(styles.choiceMark, styles.blockedMark)} />
        <div>
          <p>{props.blocked.title}</p>
          <p {...stylex.props(styles.choiceDetail, styles.blockedDetail)}>{props.blocked.detail}</p>
        </div>
      </div>
    </section>
  );
}

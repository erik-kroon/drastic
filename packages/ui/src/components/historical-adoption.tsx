import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  steps: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginBlockStart: 12,
    marginBlockEnd: 0,
    padding: 0,
    listStyleType: "none",
  },
  step: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusHistoricalStep,
    paddingBlock: 2,
    paddingInline: 9,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.captionForeground,
  },
  done: {
    borderColor: tokens.registerSuccessBorder,
    backgroundColor: tokens.registerSuccessBackground,
    color: tokens.registerSuccess,
  },
  stale: {
    borderColor: tokens.loanWarningBorder,
    backgroundColor: tokens.loanWarningBackground,
    color: tokens.registerWarning,
    fontWeight: tokens.fontWeightSemibold,
  },
  alert: {
    marginBlockStart: 14,
    paddingBlock: 10,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.historicalRefusalBorder,
    borderRadius: tokens.radiusControl,
    backgroundColor: tokens.destructiveBackground,
    color: tokens.historicalRefusalForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight18Px,
  },
  table: {
    width: "100%",
    tableLayout: "fixed",
    borderCollapse: "collapse",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  head: {
    height: 27,
    backgroundColor: tokens.sidebar,
    color: tokens.mutedForeground,
    borderBlockWidth: 1,
    borderBlockStyle: "solid",
    borderBlockColor: tokens.border,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
  },
  cell: { padding: 0, fontWeight: "inherit" },
  label: { paddingInlineStart: 8, textAlign: "left" },
  prepared: { width: 150, textAlign: "right" },
  current: { width: 130, textAlign: "right" },
  state: { width: 130, paddingInlineEnd: 8, textAlign: "right" },
  row: {
    height: 34,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
  },
  changed: { backgroundColor: tokens.historicalChangedBackground },
  warning: { color: tokens.registerWarning, fontWeight: tokens.fontWeightSemibold },
  unchanged: { color: tokens.captionForeground },
  error: { color: tokens.historicalRefusalForeground, fontWeight: tokens.fontWeightSemibold },
  strong: { fontWeight: tokens.fontWeightSemibold },
  final: { borderBlockEndColor: tokens.border },
});

export function HistoricalAdoptionSteps({
  stale,
  approved,
  adopted,
}: {
  stale: boolean;
  approved: boolean;
  adopted: boolean;
}) {
  return (
    <ol aria-label="Övertagandets steg" {...stylex.props(styles.steps)}>
      {[
        "1 Poolen skapad",
        "2 Plan förberedd",
        approved ? (stale ? "3 Godkänd, gäller inte längre" : "3 Godkänd") : "3 Godkännande",
        "4 Övertagen",
      ].map((label, index) => (
        <li
          key={label}
          {...stylex.props(
            styles.step,
            (index < 2 || (index === 2 && approved && !stale) || (index === 3 && adopted)) &&
              styles.done,
            index === 2 && approved && stale && styles.stale,
          )}
        >
          {label}
        </li>
      ))}
    </ol>
  );
}

export function HistoricalAdoptionRefusal() {
  return (
    <div role="alert" {...stylex.props(styles.alert)}>
      Poolen ändrades efter att planen godkändes. Planen gäller exakt den pool den gjordes för, så
      ingen post övertogs och inga verifikat skapades. Förbered en ny plan och godkänn den.
    </div>
  );
}

export function HistoricalAdoptionTable(props: {
  items: readonly { identity: string; prepared: string; current: string; changed: boolean }[];
  totals: readonly {
    label: string;
    prepared: string;
    current: string;
    emphasis?: boolean;
    discrepancy?: boolean;
  }[];
}) {
  return (
    <table aria-label="Planen mot poolen nu" {...stylex.props(styles.table)}>
      <thead>
        <tr {...stylex.props(styles.head)}>
          <th scope="col" {...stylex.props(styles.cell, styles.label)}>
            Post enligt SIE-filen
          </th>
          <th scope="col" {...stylex.props(styles.cell, styles.prepared)}>
            När planen gjordes
          </th>
          <th scope="col" {...stylex.props(styles.cell, styles.current)}>
            Nu
          </th>
          <th scope="col" {...stylex.props(styles.cell, styles.state)}>
            Läge
          </th>
        </tr>
      </thead>
      <tbody>
        {props.items.map((item) => (
          <tr key={item.identity} {...stylex.props(styles.row, item.changed && styles.changed)}>
            <th scope="row" {...stylex.props(styles.cell, styles.label)}>
              {item.identity}
            </th>
            <td {...stylex.props(styles.cell, styles.prepared)}>{item.prepared}</td>
            <td {...stylex.props(styles.cell, styles.current, item.changed && styles.strong)}>
              {item.current}
            </td>
            <td
              {...stylex.props(
                styles.cell,
                styles.state,
                item.changed ? styles.warning : styles.unchanged,
              )}
            >
              {item.changed ? "Ändrad" : "Oförändrad"}
            </td>
          </tr>
        ))}
        {props.totals.map((row, index) => (
          <tr
            key={row.label}
            {...stylex.props(
              styles.row,
              row.emphasis && styles.strong,
              index === props.totals.length - 1 && styles.final,
            )}
          >
            <th scope="row" {...stylex.props(styles.cell, styles.label)}>
              {row.label}
            </th>
            <td {...stylex.props(styles.cell, styles.prepared)}>{row.prepared}</td>
            <td {...stylex.props(styles.cell, styles.current, row.discrepancy && styles.error)}>
              {row.current}
            </td>
            <td {...stylex.props(styles.cell, styles.state, row.discrepancy && styles.error)}>
              {row.discrepancy ? "Stämmer inte" : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

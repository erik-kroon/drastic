import { useId, type ReactNode } from "react";
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
    height: 36,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
    ":last-child": { borderBlockEndColor: tokens.border },
  },
  label: { flexGrow: 1, minWidth: 0, paddingInlineStart: 8 },
  amount: { width: 110, flexShrink: 0, textAlign: "end" },
  outcome: {
    width: 330,
    flexShrink: 0,
    boxSizing: "border-box",
    paddingInlineEnd: 8,
    textAlign: "end",
  },
  eligible: { color: tokens.successForeground },
  excluded: { color: tokens.historicalRefusalForeground },
  group: { borderWidth: 0, padding: 0, margin: 0, minWidth: 0 },
  legend: {
    padding: 0,
    marginBlockStart: 20,
    marginBlockEnd: 6,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.captionForeground,
  },
  choice: {
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
    minHeight: 34,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    ":last-child": { borderBlockEndColor: tokens.border },
  },
  firstChoice: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
  },
  selected: { backgroundColor: tokens.sourceSelected },
  slot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    flexShrink: 0,
  },
  radio: {
    appearance: "none",
    margin: 0,
    width: 14,
    height: 14,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: tokens.input,
    borderRadius: tokens.radiusCircle,
    ":focus-visible": { outline: "2px solid var(--primary)", outlineOffset: 2 },
  },
  checkedRadio: { borderColor: tokens.primary },
  radioWrap: { position: "relative", display: "flex" },
  dot: {
    position: "absolute",
    left: 4,
    top: 4,
    width: 6,
    height: 6,
    borderRadius: tokens.radiusCircle,
    backgroundColor: tokens.primary,
    pointerEvents: "none",
  },
  choiceLabel: { flexGrow: 1 },
  detail: { paddingInlineEnd: 8 },
});

export function ClaimReceipts({
  rows,
}: {
  rows: readonly {
    id: string;
    label: ReactNode;
    amount: string;
    outcome: string;
    eligible: boolean;
  }[];
}) {
  return (
    <div role="table" aria-label="Kvitton" {...stylex.props(styles.table)}>
      <div role="rowgroup">
        <div role="row" {...stylex.props(styles.head)}>
          <span role="columnheader" {...stylex.props(styles.label)}>
            Kvitto
          </span>
          <span role="columnheader" {...stylex.props(styles.amount)}>
            Belopp
          </span>
          <span role="columnheader" {...stylex.props(styles.outcome)}>
            Läge
          </span>
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((row) => (
          <div key={row.id} role="row" {...stylex.props(styles.row)}>
            <span role="cell" {...stylex.props(styles.label)}>
              {row.label}
            </span>
            <span role="cell" {...stylex.props(styles.amount)}>
              {row.amount}
            </span>
            <span
              role="cell"
              {...stylex.props(styles.outcome, row.eligible ? styles.eligible : styles.excluded)}
            >
              {row.outcome}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type ClaimPayoutRoute = "direct" | "payroll" | "split";

export function ClaimRoutes(props: {
  legend: string;
  value: ClaimPayoutRoute;
  disabled: boolean;
  onChange: (route: ClaimPayoutRoute) => void;
  choices: readonly { value: ClaimPayoutRoute; label: string; detail?: string }[];
}) {
  const name = useId();

  return (
    <fieldset disabled={props.disabled} {...stylex.props(styles.group)}>
      <legend {...stylex.props(styles.legend)}>{props.legend}</legend>
      {props.choices.map((choice, index) => (
        <label
          key={choice.value}
          {...stylex.props(
            styles.choice,
            index === 0 && styles.firstChoice,
            choice.value === props.value && styles.selected,
          )}
        >
          <span {...stylex.props(styles.slot)}>
            <span {...stylex.props(styles.radioWrap)}>
              <input
                type="radio"
                name={name}
                value={choice.value}
                checked={choice.value === props.value}
                onChange={() => props.onChange(choice.value)}
                {...stylex.props(styles.radio, choice.value === props.value && styles.checkedRadio)}
              />
              {choice.value === props.value ? (
                <span aria-hidden="true" {...stylex.props(styles.dot)} />
              ) : null}
            </span>
          </span>
          <span {...stylex.props(styles.choiceLabel)}>{choice.label}</span>
          {choice.detail ? <span {...stylex.props(styles.detail)}>{choice.detail}</span> : null}
        </label>
      ))}
    </fieldset>
  );
}

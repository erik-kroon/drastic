import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    minHeight: tokens.voucherHeaderHeight,
    paddingInline: tokens.space5,
    backgroundColor: tokens.sidebar,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight16Px,
  },
  row: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    minHeight: tokens.controlHeightIconLg,
    paddingInline: tokens.space5,
    borderWidth: 0,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
    backgroundColor: { default: tokens.card, ":hover": tokens.sidebar },
    color: tokens.foreground,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    textAlign: "start",
    cursor: "pointer",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRingInset },
    "@media (pointer: coarse)": { minHeight: 44 },
  },
  selected: {
    backgroundColor: { default: tokens.registerSelected, ":hover": tokens.registerSelected },
    boxShadow: tokens.selectionIndicator,
  },
  period: { flex: "1", minWidth: 0, overflowWrap: "anywhere" },
  status: { width: tokens.setupColumn160, flexShrink: 0 },
  open: { color: tokens.warningForeground },
  locked: { color: tokens.successForeground },
  result: {
    width: tokens.setupColumn120,
    flexShrink: 0,
    textAlign: "end",
    fontVariantNumeric: "tabular-nums",
  },
});

export function PeriodRegister({
  labels,
  rows,
  selected,
  onSelect,
}: {
  labels: { period: string; status: string; result: string };
  rows: readonly { id: string; period: string; status: string; locked: boolean; result: string }[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.period)}>{labels.period}</span>
        <span {...stylex.props(styles.status)}>{labels.status}</span>
        <span {...stylex.props(styles.result)}>{labels.result}</span>
      </div>
      {rows.map((row) => (
        <button
          type="button"
          key={row.id}
          data-period-id={row.id}
          aria-pressed={selected === row.id}
          onClick={() => onSelect(row.id)}
          {...stylex.props(styles.row, selected === row.id && styles.selected)}
        >
          <span {...stylex.props(styles.period)}>{row.period}</span>
          <span {...stylex.props(styles.status, row.locked ? styles.locked : styles.open)}>
            {row.status}
          </span>
          <span {...stylex.props(styles.result)}>{row.result}</span>
        </button>
      ))}
    </>
  );
}

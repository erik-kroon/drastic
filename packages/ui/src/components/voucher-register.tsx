import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
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
  },
  selected: {
    backgroundColor: { default: tokens.registerSelected, ":hover": tokens.registerSelected },
    boxShadow: tokens.selectionIndicator,
    fontWeight: tokens.fontWeightMedium,
  },
  header: {
    display: "flex",
    alignItems: "center",
    minHeight: tokens.voucherHeaderHeight,
    paddingInline: tokens.space5,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    backgroundColor: tokens.sidebar,
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight16Px,
  },
  number: { width: tokens.voucherNumberWidth, flexShrink: 0, color: tokens.captionForeground },
  date: { width: tokens.voucherDateWidth, flexShrink: 0, color: tokens.captionForeground },
  description: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  amount: {
    width: tokens.voucherAmountWidth,
    flexShrink: 0,
    textAlign: "end",
    fontVariantNumeric: "tabular-nums",
  },
});

export function VoucherRegister(props: {
  labels: { number: string; date: string; description: string; amount: string };
  rows: readonly {
    id: string;
    number: string;
    date: string;
    description: string;
    amount: string;
  }[];
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.number)}>{props.labels.number}</span>
        <span {...stylex.props(styles.date)}>{props.labels.date}</span>
        <span {...stylex.props(styles.description)}>{props.labels.description}</span>
        <span {...stylex.props(styles.amount)}>{props.labels.amount}</span>
      </div>
      {props.rows.map((row) => (
        <button
          type="button"
          key={row.id}
          data-voucher-id={row.id}
          aria-pressed={props.selected === row.id}
          onClick={() => props.onSelect(row.id)}
          {...stylex.props(styles.row, props.selected === row.id && styles.selected)}
        >
          <span {...stylex.props(styles.number)}>{row.number}</span>
          <span {...stylex.props(styles.date)}>{row.date}</span>
          <span {...stylex.props(styles.description)}>{row.description}</span>
          <span {...stylex.props(styles.amount)}>{row.amount}</span>
        </button>
      ))}
    </>
  );
}

import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space3,
    minHeight: 30,
    paddingInline: tokens.space5,
    backgroundColor: tokens.sidebar,
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space3,
    width: "100%",
    minHeight: 40,
    paddingInline: tokens.space5,
    paddingBlock: tokens.space2,
    borderWidth: 0,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
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
    fontWeight: tokens.fontWeightMedium,
  },
  name: { flex: "1", minWidth: 0, overflowWrap: "anywhere" },
  role: {
    width: 110,
    flexShrink: 0,
    color: tokens.mutedForeground,
    "@container (max-width: 40rem)": { display: "none" },
  },
  reference: {
    width: 130,
    flexShrink: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "end",
    color: tokens.mutedForeground,
    "@container (max-width: 40rem)": { width: 90 },
  },
});

export function ContactRegister(props: {
  labels: { name: string; role: string; reference: string };
  rows: readonly { id: string; name: string; role: string; reference: string }[];
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.name)}>{props.labels.name}</span>
        <span {...stylex.props(styles.role)}>{props.labels.role}</span>
        <span {...stylex.props(styles.reference)}>{props.labels.reference}</span>
      </div>
      {props.rows.map((row) => (
        <button
          key={row.id}
          type="button"
          data-contact-id={row.id}
          aria-pressed={props.selected === row.id}
          onClick={() => props.onSelect(row.id)}
          {...stylex.props(styles.row, props.selected === row.id && styles.selected)}
        >
          <span {...stylex.props(styles.name)}>{row.name}</span>
          <span {...stylex.props(styles.role)}>{row.role}</span>
          <span title={row.reference} {...stylex.props(styles.reference)}>
            {row.reference}
          </span>
        </button>
      ))}
    </>
  );
}

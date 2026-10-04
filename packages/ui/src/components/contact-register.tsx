import type { ReactNode } from "react";
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
  financialRow: { gap: 0 },
  financial: { width: 110, flexShrink: 0, textAlign: "end", fontVariantNumeric: "tabular-nums" },
  overdue: { color: tokens.destructive },
  facts: { marginBlockStart: tokens.space3_5 },
  fact: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space2,
    minHeight: tokens.controlHeight,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  factsEnd: {
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  factLabel: { color: tokens.captionForeground },
  factValue: { textAlign: "end" },
  preview: { display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 40px)" },
});

export function ContactFacts({ rows }: { rows: readonly { label: string; value: ReactNode }[] }) {
  return (
    <dl {...stylex.props(styles.facts, styles.factsEnd)}>
      {rows.map((row) => (
        <div key={row.label} {...stylex.props(styles.fact)}>
          <dt {...stylex.props(styles.factLabel)}>{row.label}</dt>
          <dd {...stylex.props(styles.factValue)}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ContactPreviewLayout({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.preview)}>{children}</div>;
}

export function ContactRegister(props: {
  labels: { name: string; role: string; reference: string };
  rows: readonly { id: string; name: string; role: string; reference: string }[];
  selected: string | undefined;
  onSelect: (id: string) => void;
  financial?: {
    labels: { open: string; invoiced: string };
    rows: Readonly<Record<string, { open: string; invoiced: string; overdue: boolean }>>;
  };
}) {
  return (
    <>
      <div {...stylex.props(styles.header, props.financial && styles.financialRow)}>
        <span {...stylex.props(styles.name)}>{props.labels.name}</span>
        {props.financial ? (
          <>
            <span {...stylex.props(styles.financial)}>{props.financial.labels.open}</span>
            <span {...stylex.props(styles.financial)}>{props.financial.labels.invoiced}</span>
          </>
        ) : (
          <>
            <span {...stylex.props(styles.role)}>{props.labels.role}</span>
            <span {...stylex.props(styles.reference)}>{props.labels.reference}</span>
          </>
        )}
      </div>
      {props.rows.map((row) => (
        <button
          key={row.id}
          type="button"
          data-contact-id={row.id}
          aria-pressed={props.selected === row.id}
          onClick={() => props.onSelect(row.id)}
          {...stylex.props(
            styles.row,
            props.financial && styles.financialRow,
            props.selected === row.id && styles.selected,
          )}
        >
          <span {...stylex.props(styles.name)}>{row.name}</span>
          {props.financial ? (
            <>
              <span
                {...stylex.props(
                  styles.financial,
                  props.financial.rows[row.id]?.overdue && styles.overdue,
                )}
              >
                {props.financial.rows[row.id]?.open ?? "—"}
              </span>
              <span {...stylex.props(styles.financial)}>
                {props.financial.rows[row.id]?.invoiced ?? "—"}
              </span>
            </>
          ) : (
            <>
              <span {...stylex.props(styles.role)}>{row.role}</span>
              <span title={row.reference} {...stylex.props(styles.reference)}>
                {row.reference}
              </span>
            </>
          )}
        </button>
      ))}
    </>
  );
}

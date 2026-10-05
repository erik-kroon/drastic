import { useId, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  facts: { margin: 0 },
  row: {
    display: "flex",
    alignItems: "center",
    minHeight: 32,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    ":first-child": {
      borderBlockStartWidth: 1,
      borderBlockStartStyle: "solid",
      borderBlockStartColor: tokens.border,
    },
  },
  label: { width: 240, flexShrink: 0, color: tokens.captionForeground },
  calculation: { justifyContent: "space-between" },
  firstCalculation: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
  },
  emphasis: { fontWeight: tokens.fontWeightSemibold, borderBlockEndColor: tokens.border },
  value: { margin: 0 },
  fields: { display: "flex", flexWrap: "wrap", alignItems: "start", gap: 24 },
  field: { display: "flex", flexDirection: "column", width: 260, maxWidth: "100%" },
  caption: {
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.captionForeground,
  },
  control: {
    boxSizing: "border-box",
    width: "100%",
    height: 32,
    marginBlockStart: 4,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.input,
    borderRadius: tokens.radiusControl,
    backgroundColor: tokens.background,
    color: tokens.foreground,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    ":focus": { borderColor: tokens.primary, outlineWidth: 0 },
  },
  numeric: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
  evidence: { display: "flex", alignItems: "center", textAlign: "left", cursor: "pointer" },
  note: {
    marginBlockStart: 8,
    marginBlockEnd: 0,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight18Px,
    color: tokens.registerSuccess,
  },
});

export function ForeignCashBankRows({
  rows,
}: {
  rows: readonly { label: string; value: string }[];
}) {
  return (
    <dl {...stylex.props(styles.facts)}>
      {rows.map((row) => (
        <div key={row.label} {...stylex.props(styles.row)}>
          <dt {...stylex.props(styles.label)}>{row.label}</dt>
          <dd {...stylex.props(styles.value)}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ForeignCashFields({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.fields)}>{children}</div>;
}

export function ForeignCashAmount(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  focus?: boolean;
  disabled?: boolean;
}) {
  const id = useId();

  return (
    <div {...stylex.props(styles.field)}>
      <label htmlFor={id} {...stylex.props(styles.caption)}>
        {props.label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        autoFocus={props.focus}
        disabled={props.disabled}
        {...stylex.props(styles.control, styles.numeric)}
      />
    </div>
  );
}

export function ForeignCashFeeEvidence({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <div {...stylex.props(styles.field)}>
      <span {...stylex.props(styles.caption)}>Underlag för avgiften</span>
      <button type="button" onClick={onOpen} {...stylex.props(styles.control, styles.evidence)}>
        {title}
      </button>
    </div>
  );
}

export function ForeignCashSourceNote({ children }: { children: ReactNode }) {
  return <p {...stylex.props(styles.note)}>{children}</p>;
}

export function ForeignCashCalculationFact(props: {
  label: string;
  value: string;
  emphasis?: boolean;
  first?: boolean;
}) {
  return (
    <div
      {...stylex.props(
        styles.row,
        styles.calculation,
        props.first && styles.firstCalculation,
        props.emphasis && styles.emphasis,
      )}
    >
      <span>{props.label}</span>
      <span {...stylex.props(styles.numeric)}>{props.value}</span>
    </div>
  );
}

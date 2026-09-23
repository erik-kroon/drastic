import { useId, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  field: { borderWidth: 0, padding: 0, margin: 0, minWidth: 0 },
  legend: {
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightMedium,
    marginBlockEnd: 8,
    padding: 0,
  },
  options: { display: "flex", flexWrap: "wrap", gap: 8 },
  option: {
    display: "flex",
    alignItems: "start",
    gap: 8,
    flex: "1 1 auto",
    minHeight: 40,
    paddingBlock: 10,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: { default: tokens.card, ":hover": tokens.muted },
    cursor: "pointer",
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeightBodyCompact,
  },
  paired: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
  selected: { borderColor: tokens.borderActive, backgroundColor: tokens.muted },
  radio: { margin: 0, marginBlockStart: 2, accentColor: tokens.foreground, flexShrink: 0 },
  text: { display: "grid", gap: 4 },
  description: { color: tokens.mutedForeground, fontSize: tokens.fontSizeXs, textWrap: "pretty" },
});

export function ChoiceField(props: {
  label: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  options: readonly { value: string; label: string; description?: string }[];
}) {
  const id = useId();
  const [localValue, setLocalValue] = useState(props.defaultValue);
  const selected = props.value ?? localValue;
  return (
    <fieldset disabled={props.disabled} {...stylex.props(styles.field)}>
      <legend {...stylex.props(styles.legend)}>{props.label}</legend>
      <div {...stylex.props(styles.options, props.options.length === 4 && styles.paired)}>
        {props.options.map((option) => (
          <label
            key={option.value}
            {...stylex.props(styles.option, selected === option.value && styles.selected)}
          >
            <input
              type="radio"
              name={props.name ?? id}
              value={option.value}
              checked={selected === option.value}
              required={props.required}
              onChange={() => {
                setLocalValue(option.value);
                props.onValueChange?.(option.value);
              }}
              {...stylex.props(styles.radio)}
            />
            <span {...stylex.props(styles.text)}>
              <span>{option.label}</span>
              {option.description ? (
                <span {...stylex.props(styles.description)}>{option.description}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

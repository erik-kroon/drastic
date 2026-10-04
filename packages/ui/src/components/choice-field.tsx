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
  decisionOptions: {
    display: "flex",
    flexDirection: "column",
    flexWrap: "nowrap",
    width: tokens.setupFocusedWidth,
    gap: tokens.space2_5,
  },
  decisionOption: {
    flex: "none",
    minHeight: 0,
    width: tokens.setupFocusedWidth,
    paddingBlock: tokens.space3_5,
    paddingInline: tokens.space4,
    gap: tokens.space3,
    borderColor: tokens.input,
    borderRadius: tokens.radiusSurface,
    backgroundColor: { default: tokens.card, ":hover": tokens.sidebar },
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    ":focus-within": { outline: tokens.setupControlFocus, outlineOffset: 2 },
  },
  decisionSelected: {
    borderWidth: 2,
    borderColor: tokens.primary,
    backgroundColor: { default: tokens.registerSelected, ":hover": tokens.registerSelected },
  },
  decisionRadio: {
    appearance: "none",
    width: tokens.setupDecisionRadioSize,
    height: tokens.setupDecisionRadioSize,
    marginBlockStart: tokens.space0_25,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.input,
    borderRadius: tokens.radiusSurface,
    backgroundColor: tokens.card,
    ":focus-visible": { outline: "none" },
  },
  decisionRadioSelected: { borderWidth: 5, borderColor: tokens.primary },
  decisionText: { display: "flex", flexDirection: "column", gap: tokens.space0_5 },
  decisionLabel: { fontWeight: tokens.fontWeightMedium },
  decisionDescription: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    textWrap: "wrap",
  },
  hiddenLegend: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
});

export function ChoiceField(props: {
  label: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  presentation?: "decision-cards";
  hideLabel?: boolean;
  onValueChange?: (value: string) => void;
  options: readonly { value: string; label: string; description?: string }[];
}) {
  const id = useId();
  const [localValue, setLocalValue] = useState(props.defaultValue);
  const selected = props.value ?? localValue;
  const decisionCards = props.presentation === "decision-cards";

  return (
    <fieldset disabled={props.disabled} {...stylex.props(styles.field)}>
      <legend {...stylex.props(styles.legend, props.hideLabel && styles.hiddenLegend)}>
        {props.label}
      </legend>
      <div
        {...stylex.props(
          styles.options,
          props.options.length === 4 && !decisionCards && styles.paired,
          decisionCards && styles.decisionOptions,
        )}
      >
        {props.options.map((option) => (
          <label
            key={option.value}
            {...stylex.props(
              styles.option,
              selected === option.value && styles.selected,
              decisionCards && styles.decisionOption,
              decisionCards && selected === option.value && styles.decisionSelected,
            )}
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
              {...stylex.props(
                styles.radio,
                decisionCards && styles.decisionRadio,
                decisionCards && selected === option.value && styles.decisionRadioSelected,
              )}
            />
            <span {...stylex.props(styles.text, decisionCards && styles.decisionText)}>
              <span {...stylex.props(decisionCards && styles.decisionLabel)}>{option.label}</span>
              {option.description ? (
                <span
                  {...stylex.props(styles.description, decisionCards && styles.decisionDescription)}
                >
                  {option.description}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

import type { ComponentProps, ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  label: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.space2,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.foreground,
    cursor: "pointer",
  },
  checkbox: {
    appearance: "none",
    width: 16,
    height: 16,
    flexShrink: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.input,
    borderRadius: tokens.radiusChoiceCheckbox,
    backgroundColor: tokens.card,
    cursor: "pointer",
    position: "relative",
    ":focus-visible": { outline: "2px solid var(--primary)", outlineOffset: 2 },
    ":disabled": { cursor: "not-allowed", backgroundColor: tokens.controlDisabledBackground },
  },
  checkedCheckbox: { backgroundColor: tokens.primary, borderColor: tokens.primary },
  preservedDisabledCheckbox: { ":disabled": { backgroundColor: tokens.card } },
  checkWrap: { position: "relative", width: 16, height: 16, display: "flex", flexShrink: 0 },
  check: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    color: tokens.primaryForeground,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightBold,
    textAlign: "center",
    lineHeight: tokens.lineHeight16Px,
  },
  switch: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: tokens.radiusFull,
    width: 36,
    height: 20,
    padding: 2,
    backgroundColor: tokens.input,
    cursor: "pointer",
    flexShrink: 0,
    ":focus-visible": { outline: "2px solid var(--primary)", outlineOffset: 2 },
    ":disabled": { cursor: "not-allowed" },
  },
  switchOn: { backgroundColor: tokens.primary },
  thumb: {
    width: 16,
    height: 16,
    borderRadius: tokens.radiusFull,
    backgroundColor: tokens.card,
    transform: "translateX(0)",
  },
  thumbOn: { transform: "translateX(16px)" },
  decision: {
    display: "flex",
    alignItems: "start",
    gap: tokens.space2_5,
    paddingBlock: tokens.space2_5,
    paddingInline: tokens.space3,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.input,
    borderRadius: tokens.radiusSurface,
    cursor: "pointer",
    color: tokens.foreground,
  },
  selectedDecision: { borderWidth: 2, borderColor: tokens.primary },
  radio: {
    appearance: "none",
    width: 16,
    height: 16,
    marginBlockStart: 2,
    flexShrink: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.input,
    borderRadius: tokens.radiusFull,
    cursor: "pointer",
    ":focus-visible": { outline: "2px solid var(--primary)", outlineOffset: 2 },
  },
  checkedRadio: { borderWidth: 5, borderColor: tokens.primary },
  title: {
    display: "block",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  detail: {
    display: "block",
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.mutedForeground,
  },
});

type CheckboxControlProps = Omit<
  ComponentProps<"input">,
  "type" | "className" | "style" | "defaultChecked"
> & { label: ReactNode; checked: boolean; disabledAppearance?: "preserve" };

export function CheckboxControl({
  label,
  checked,
  disabledAppearance,
  ...props
}: CheckboxControlProps) {
  return (
    <label {...stylex.props(styles.label)}>
      <span {...stylex.props(styles.checkWrap)}>
        <input
          {...props}
          type="checkbox"
          checked={checked}
          {...stylex.props(
            styles.checkbox,
            checked && styles.checkedCheckbox,
            disabledAppearance === "preserve" && !checked && styles.preservedDisabledCheckbox,
          )}
        />
        {checked ? (
          <span aria-hidden="true" {...stylex.props(styles.check)}>
            ✓
          </span>
        ) : null}
      </span>
      {label}
    </label>
  );
}

type SwitchControlProps = Omit<
  ComponentProps<"button">,
  "role" | "aria-checked" | "className" | "style" | "onChange" | "onClick"
> & { checked: boolean; label: string; onCheckedChange: (checked: boolean) => void };

export function SwitchControl({ checked, label, onCheckedChange, ...props }: SwitchControlProps) {
  return (
    <span {...stylex.props(styles.label)}>
      <button
        {...props}
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        {...stylex.props(styles.switch, checked && styles.switchOn)}
      >
        <span aria-hidden="true" {...stylex.props(styles.thumb, checked && styles.thumbOn)} />
      </button>
      <span>{label}</span>
    </span>
  );
}

type DecisionCardProps = Omit<
  ComponentProps<"input">,
  "type" | "className" | "style" | "title" | "defaultChecked"
> & { title: string; detail: string; checked: boolean };

export function DecisionCard({ title, detail, checked, ...props }: DecisionCardProps) {
  return (
    <label {...stylex.props(styles.decision, checked && styles.selectedDecision)}>
      <input
        {...props}
        type="radio"
        checked={checked}
        {...stylex.props(styles.radio, checked && styles.checkedRadio)}
      />
      <span>
        <span {...stylex.props(styles.title)}>{title}</span>
        <span {...stylex.props(styles.detail)}>{detail}</span>
      </span>
    </label>
  );
}

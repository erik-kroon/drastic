import { useId, type ComponentProps } from "react";
import { Input, type InputProps } from "@open-erp/ui/components/input";
import { Label } from "@open-erp/ui/components/label";
import { SelectControl, type SelectControlProps } from "@open-erp/ui/components/select";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  field: {
    display: "grid",
    gap: tokens.space2,
    minWidth: 0,
    flex: "1 1 10rem",
    alignContent: "start",
  },
  label: {
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightMedium,
    lineHeight: tokens.lineHeightBodyCompact,
  },
  textarea: {
    padding: tokens.space3,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.background,
    color: tokens.foreground,
    resize: "vertical",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeightNormal,
    ":focus-visible": { outline: "none", boxShadow: tokens.controlFocusShadow },
  },
  numeric: { textAlign: "end", fontVariantNumeric: "tabular-nums" },
  control: {
    minHeight: { default: tokens.space9, "@media (pointer: coarse)": tokens.space11 },
    paddingInline: tokens.space3,
    fontSize: { default: tokens.fontSizeBase, "@media (min-width: 768px)": tokens.fontSizeSm },
  },
});

/** Labeled controls with shared sizing and stable label associations. */
export function InputField({
  label,
  id,
  styleX,
  suggestions,
  ...props
}: InputProps & { label: string; suggestions?: readonly string[] }) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return (
    <div {...stylex.props(styles.field)}>
      <Label htmlFor={controlId} disabled={props.disabled} styleX={styles.label}>
        {label}
      </Label>
      <Input
        {...props}
        id={controlId}
        list={suggestions?.length ? `${controlId}-options` : props.list}
        styleX={[styles.control, props.inputMode === "decimal" && styles.numeric, styleX]}
      />
      {suggestions?.length ? (
        <datalist id={`${controlId}-options`}>
          {suggestions.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}
export function SelectField({
  label,
  id,
  styleX,
  ...props
}: SelectControlProps & { label: string }) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;
  return (
    <div {...stylex.props(styles.field)}>
      <Label id={labelId} htmlFor={controlId} disabled={props.disabled} styleX={styles.label}>
        {label}
      </Label>
      <SelectControl
        aria-labelledby={labelId}
        {...props}
        id={controlId}
        styleX={[styles.control, styleX]}
      />
    </div>
  );
}

export function TextareaField({
  label,
  id,
  ...props
}: Omit<ComponentProps<"textarea">, "className" | "style"> & { label: string }) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return (
    <div {...stylex.props(styles.field)}>
      <Label htmlFor={controlId} styleX={styles.label}>
        {label}
      </Label>
      <textarea {...props} id={controlId} {...stylex.props(styles.textarea)} />
    </div>
  );
}

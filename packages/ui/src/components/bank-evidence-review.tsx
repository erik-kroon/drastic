import { useId, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { Input } from "@open-erp/ui/components/input";
import { Label } from "@open-erp/ui/components/label";

const styles = stylex.create({
  columns: {
    display: "flex",
    minWidth: 0,
    minHeight: "100%",
    fontFamily: tokens.fontSans,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  original: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minWidth: 0,
    gap: tokens.space6,
    paddingBlock: tokens.space6,
    paddingInline: tokens.space8,
    backgroundColor: tokens.reviewSideSurface,
  },
  decision: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    width: 420,
    minWidth: 0,
    gap: tokens.space6,
    padding: tokens.space6,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.border,
  },
  field: { display: "grid", gap: tokens.space2, minWidth: 0 },
  label: {
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    fontWeight: tokens.fontWeightNormal,
  },
  input: { minHeight: 32, fontSize: tokens.fontSizeControl, lineHeight: tokens.lineHeight16Px },
  reason: {
    boxSizing: "border-box",
    minHeight: 64,
    width: "100%",
    paddingBlock: tokens.space2,
    paddingInline: tokens.space2_5,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.input,
    borderRadius: tokens.radiusControl,
    backgroundColor: tokens.card,
    color: tokens.foreground,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    resize: "vertical",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  acknowledgment: { display: "flex", alignItems: "start", gap: tokens.space2, cursor: "pointer" },
  checkbox: {
    width: 16,
    height: 16,
    flexShrink: 0,
    margin: 0,
    accentColor: tokens.primary,
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  error: {
    color: tokens.destructive,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    margin: 0,
  },
});

export function BankEvidenceReview({
  bank,
  original,
  decision,
}: {
  bank: ReactNode;
  original: ReactNode;
  decision: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.columns)}>
      <section aria-label="Bank" {...stylex.props(styles.original)}>
        {bank}
        {original}
      </section>
      <section aria-label="Matchning" {...stylex.props(styles.decision)}>
        {decision}
      </section>
    </div>
  );
}

export function BankReviewAmount({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();

  return (
    <div {...stylex.props(styles.field)}>
      <Label htmlFor={id} styleX={styles.label}>
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        inputMode="decimal"
        required
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        styleX={styles.input}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function BankReviewReason({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();

  return (
    <div {...stylex.props(styles.field)}>
      <Label htmlFor={id} styleX={styles.label}>
        {label}
      </Label>
      <textarea
        id={id}
        name="reason"
        value={value}
        required
        maxLength={2000}
        {...stylex.props(styles.reason)}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function BankReviewAcknowledgment({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label {...stylex.props(styles.acknowledgment, styles.label)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        {...stylex.props(styles.checkbox)}
      />
      <span>{label}</span>
    </label>
  );
}

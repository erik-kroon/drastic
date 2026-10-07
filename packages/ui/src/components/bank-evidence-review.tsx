import { useState, useId, type ReactNode, type ComponentProps } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { Input } from "@open-erp/ui/components/input";
import { Label } from "@open-erp/ui/components/label";
import { Link } from "@open-erp/ui/components/link";
import { Button } from "@open-erp/ui/components/button";

const styles = stylex.create({
  columns: {
    display: "flex",
    minWidth: 0,
    minHeight: `calc(100dvh - ${tokens.space12})`,
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
  submit: { width: "100%", minHeight: tokens.controlHeightSm, height: tokens.controlHeightSm },
  disabledSubmit: { fontWeight: tokens.fontWeightNormal },
  candidateAction: { paddingInline: tokens.space2_5 },
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
    paddingBlock: 7,
    paddingInline: tokens.space2_5,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.input,
    borderRadius: tokens.radiusControl,
    backgroundColor: tokens.card,
    color: tokens.reviewText,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    resize: "none",
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
  section: {
    display: "grid",
    gap: tokens.space3,
    minWidth: 0,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    paddingBlockEnd: tokens.space6,
  },
  bankSection: { gap: tokens.space2 },
  openSection: { borderBlockEndWidth: 0, paddingBlockEnd: 0 },
  caption: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
  },
  sectionTitle: { fontWeight: tokens.fontWeightSemibold },
  originalFooter: { display: "grid", gap: tokens.space2 },
  originalHeading: {
    display: "flex",
    alignItems: "center",
    height: `calc(${tokens.voucherHeaderHeight} - 1px)`,
    fontWeight: tokens.fontWeightSemibold,
  },
  facts: {
    display: "grid",
    gap: tokens.space3,
    paddingBlockStart: tokens.space3,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
  },
  footer: {
    display: "grid",
    gap: tokens.space3,
    marginBlockStart: "auto",
    paddingBlockStart: tokens.space4,
  },
  placeholder: {
    alignSelf: "center",
    justifySelf: "center",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 595,
    maxWidth: "100%",
    height: 480,
    backgroundColor: tokens.card,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    color: tokens.mutedForeground,
  },
  refusal: {
    "--foreground": tokens.reviewText,
    flexDirection: "column",
    alignItems: "stretch",
    paddingInline: tokens.space16,
    gap: tokens.space3,
    color: tokens.reviewText,
  },
  preparedPlan: {
    "--foreground": tokens.reviewText,
    color: tokens.reviewText,
    display: "grid",
    gap: tokens.space3,
  },
  refusalAction: { paddingBlockStart: tokens.space2 },
  refusalTitle: {
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeight20Px,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.destructive,
  },
  refusalDescription: { fontSize: tokens.fontSizeControl, lineHeight: tokens.lineHeight20Px },
  checksum: {
    fontFamily: tokens.fontMono,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.mutedForeground,
  },
  candidate: {
    display: "grid",
    gap: tokens.space2,
    padding: tokens.space3,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
  },
  candidateTitle: {
    margin: 0,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  warningCaption: { fontSize: tokens.fontSizeXs },
  destructiveWarning: { color: tokens.destructive },
  warning: {
    color: tokens.warningForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: tokens.space3,
    minWidth: 0,
  },
  headingRow: { alignItems: "center" },
  amount: { whiteSpace: "nowrap", flexShrink: 0 },
  title: {
    fontFamily: tokens.fontFamilySystem,
    margin: 0,
    fontSize: tokens.fontSizeBase,
    lineHeight: tokens.lineHeight20Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  bankAmount: {
    fontFamily: tokens.fontFamilySystem,
    fontSize: tokens.fontSizeXl,
    lineHeight: tokens.lineHeight24Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  metadata: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.space6,
    color: tokens.mutedForeground,
  },
  link: {
    display: "inline",
    width: "fit-content",
    padding: 0,
    borderWidth: 0,
    backgroundColor: tokens.transparent,
    color: tokens.primary,
    textDecoration: "underline",
    textDecorationThickness: 1,
    textUnderlinePosition: "from-font",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
});

export function BankReviewSubmit(props: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      size="sm"
      styleX={[styles.submit, props.disabled && styles.disabledSubmit]}
    />
  );
}

export function BankReviewOriginalFooter({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.originalFooter)}>{children}</div>;
}

export function BankReviewCaption({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.caption)}>{children}</div>;
}

export function BankReviewSectionTitle({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.sectionTitle)}>{children}</div>;
}

export function BankReviewSection({
  children,
  bank,
  open,
}: {
  children: ReactNode;
  bank?: boolean;
  open?: boolean;
}) {
  return (
    <div {...stylex.props(styles.section, bank && styles.bankSection, open && styles.openSection)}>
      {children}
    </div>
  );
}

export function BankReviewFacts({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.facts)}>{children}</div>;
}

export function BankReviewPreparedPlan({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.preparedPlan)}>{children}</div>;
}

export function BankReviewFooter({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.footer)}>{children}</div>;
}

export function BankReviewOriginalPlaceholder({ children }: { children: ReactNode }) {
  return (
    <>
      <div {...stylex.props(styles.originalHeading)}>Original</div>
      <div {...stylex.props(styles.placeholder)}>{children}</div>
    </>
  );
}

export function BankReviewOriginalRefusal({
  title,
  description,
  checksum,
  action,
}: {
  title: string;
  description: string;
  checksum?: string;
  action: ReactNode;
}) {
  const digest = checksum?.replace(/^sha256:/, "");

  return (
    <>
      <div {...stylex.props(styles.originalHeading)}>Original</div>
      <div {...stylex.props(styles.placeholder, styles.refusal)}>
        <div role="alert" {...stylex.props(styles.refusalTitle)}>
          {title}
        </div>
        <div {...stylex.props(styles.refusalDescription)}>{description}</div>
        {digest ? (
          <div title={checksum} {...stylex.props(styles.checksum)}>
            Sparad SHA-256 {digest.slice(0, 8)}…{digest.slice(-6)}
          </div>
        ) : null}
        <div {...stylex.props(styles.refusalAction)}>{action}</div>
      </div>
    </>
  );
}

export function BankReviewCandidateCard({
  title,
  amount,
  detail,
  identity,
  disabled,
  onReview,
  action,
}: {
  title: ReactNode;
  amount: ReactNode;
  detail: ReactNode;
  identity: string;
  disabled: boolean;
  onReview: () => void;
  action: string;
}) {
  return (
    <article aria-label={identity} {...stylex.props(styles.candidate)}>
      <div {...stylex.props(styles.row)}>
        <h3 {...stylex.props(styles.candidateTitle)}>{title}</h3>
        <span {...stylex.props(styles.amount)}>{amount}</span>
      </div>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.caption)}>{detail}</span>
        <Button
          variant="outline"
          size="sm"
          styleX={styles.candidateAction}
          disabled={disabled}
          onClick={onReview}
        >
          {action}
        </Button>
      </div>
    </article>
  );
}

export function BankReviewWarning({
  children,
  destructive,
  caption,
}: {
  children: ReactNode;
  destructive?: boolean;
  caption?: boolean;
}) {
  return (
    <div
      {...stylex.props(
        styles.warning,
        caption && styles.warningCaption,
        destructive && styles.destructiveWarning,
      )}
    >
      {children}
    </div>
  );
}

export function BankReviewFact({
  label,
  children,
  align = "baseline",
}: {
  label: ReactNode;
  children: ReactNode;
  align?: "baseline" | "center";
}) {
  return (
    <div {...stylex.props(styles.row, align === "center" && styles.headingRow)}>
      <span>{label}</span>
      <span {...stylex.props(styles.amount)}>{children}</span>
    </div>
  );
}

export function BankReviewHeading({
  title,
  amount,
  metadata,
}: {
  title: ReactNode;
  amount?: ReactNode;
  metadata?: ReactNode;
}) {
  return (
    <>
      <div {...stylex.props(styles.row, styles.headingRow)}>
        <h2 {...stylex.props(styles.title)}>{title}</h2>
        {amount ? <span {...stylex.props(styles.amount, styles.bankAmount)}>{amount}</span> : null}
      </div>
      {metadata ? <div {...stylex.props(styles.metadata)}>{metadata}</div> : null}
    </>
  );
}

export function BankReviewLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} {...stylex.props(styles.link)} />;
}

export function BankReviewTextAction(props: ComponentProps<typeof Button>) {
  return <Button {...props} variant="unstyled" styleX={styles.link} />;
}

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
  formattedValue,
  error,
  onChange,
}: {
  label: string;
  value: string;
  formattedValue?: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);

  return (
    <div {...stylex.props(styles.field)}>
      <Label htmlFor={id} styleX={styles.label}>
        {label}
      </Label>
      <Input
        id={id}
        value={editing ? value : (formattedValue ?? value)}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
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

import * as stylex from "@stylexjs/stylex";
import { useId, type ComponentProps, type ReactNode } from "react";
import { kanon } from "@open-erp/ui/theme/kanon.stylex";
import { statusTextStyle, type Status } from "@open-erp/ui/kanon/status";
import { Action, InlineAction } from "@open-erp/ui/kanon/action";

const styles = stylex.create({
  hiddenLabel: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  column: {
    display: "grid",
    gap: kanon.space4,
    width: "100%",
    maxWidth: kanon.sizeAgreementForm,
    marginInline: "auto",
    minWidth: 0,
  },
  compactColumn: { gap: kanon.space2 },
  disclosureSummary: {
    display: "block",
    cursor: "pointer",
    ":focus-visible": { outline: "none", boxShadow: kanon.shadowFocus },
  },
  header: { display: "grid", gap: kanon.space1 },
  recordHeader: { gap: kanon.space2 },
  recordFact: { lineHeight: kanon.leadingSection },
  recordField: { gap: kanon.space2 },
  recordControl: { height: kanon.sizeButtonPrimary },
  compactFacts: { gap: kanon.space2 },
  compactSection: { gap: kanon.space2 },
  secondaryLabel: {
    color: kanon.colorSecondary,
    fontFamily: kanon.fontControl,
    lineHeight: kanon.leadingSection,
  },
  recordFacts: { gap: kanon.space3, fontFamily: kanon.fontControl },
  recordTerm: { color: kanon.colorText, fontFamily: kanon.fontControl },
  recordSection: { display: "grid", gap: kanon.space3, fontFamily: kanon.fontControl },
  recordLabel: {
    fontFamily: kanon.fontUi,
    fontSize: kanon.textCaption,
    fontWeight: kanon.weightSemibold,
    lineHeight: kanon.leadingBody,
    color: kanon.colorText,
    margin: 0,
  },
  compactText: { lineHeight: kanon.leadingBody, fontFamily: kanon.fontControl },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    gap: kanon.space5,
    "@container (max-width: 40rem)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  field: { display: "grid", gap: kanon.space15, minWidth: 0 },
  label: {
    color: kanon.colorText,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textCaption,
    lineHeight: kanon.leadingBody,
  },
  control: {
    appearance: "none",
    backgroundColor: kanon.colorSurface,
    borderColor: kanon.colorControl,
    borderRadius: kanon.radiusControl,
    borderStyle: "solid",
    borderWidth: 1,
    boxSizing: "border-box",
    color: kanon.colorText,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textBody,
    height: kanon.sizeButton,
    lineHeight: kanon.leadingBody,
    minWidth: 0,
    paddingInline: kanon.space25,
    width: "100%",
    "::placeholder": { color: kanon.colorText, opacity: 1 },
    ":focus-visible": { outline: "none", boxShadow: kanon.shadowFocus },
    ":disabled": { backgroundColor: kanon.colorSideSurface },
  },
  readOnly: { backgroundColor: kanon.colorSideSurface },
  recordFont: { fontFamily: kanon.fontControl },
  spreadActions: { justifyContent: "space-between" },
  paddedActions: { paddingBlock: kanon.space2 },
  title: {
    color: kanon.colorText,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textFormTitle,
    fontWeight: kanon.weightSemibold,
    lineHeight: kanon.leadingFormTitle,
    margin: 0,
  },
  text: {
    color: kanon.colorSecondary,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingSection,
    margin: 0,
    overflowWrap: "anywhere",
  },
  note: {
    color: kanon.colorSecondary,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textCaption,
    lineHeight: kanon.leadingSection,
    margin: 0,
  },
  facts: { display: "grid", gap: kanon.space2, margin: 0 },
  fact: {
    display: "grid",
    gridTemplateColumns: `${kanon.sizeLabelColumn} minmax(0, 1fr)`,
    gap: kanon.space3,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
  },
  term: { color: kanon.colorSecondary },
  wideFact: { gridTemplateColumns: "minmax(0, 1fr) auto" },
  endValue: { textAlign: "end" },
  value: { color: kanon.colorText, margin: 0, overflowWrap: "anywhere" },
  actions: { display: "flex", gap: kanon.space3, flexWrap: "wrap", alignItems: "center" },
});

export function FormColumn({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return <div {...stylex.props(styles.column, compact && styles.compactColumn)}>{children}</div>;
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.row)}>{children}</div>;
}

export function FormTitle({ children, record }: { children: ReactNode; record?: boolean }) {
  return <h2 {...stylex.props(styles.title, record && styles.recordFont)}>{children}</h2>;
}

export function FormText(props: {
  tone?: Status;
  record?: boolean;
  children: ReactNode;
  role?: "status" | "alert";
  compact?: boolean;
}) {
  const { children, role, compact, record } = props;

  return (
    <p
      role={role}
      {...stylex.props(
        styles.text,
        record && styles.recordFont,
        compact && styles.compactText,
        props.tone && statusTextStyle(props.tone),
      )}
    >
      {children}
    </p>
  );
}

export function FormNote({
  children,
  record,
  compact,
}: {
  children: ReactNode;
  record?: boolean;
  compact?: boolean;
}) {
  return (
    <p {...stylex.props(styles.note, record && styles.recordFont, compact && styles.compactText)}>
      {children}
    </p>
  );
}

export function InputField(props: ComponentProps<"input"> & { label: string }) {
  const input = { ...props };
  Reflect.deleteProperty(input, "label");
  const generated = useId();
  const id = props.id ?? generated;

  return (
    <label htmlFor={id} {...stylex.props(styles.field)}>
      <span {...stylex.props(styles.label)}>{props.label}</span>
      <input
        {...input}
        id={id}
        {...stylex.props(styles.control, props.readOnly && styles.readOnly)}
      />
    </label>
  );
}

export function SelectField(
  props: Omit<ComponentProps<"select">, "onChange"> & {
    label: string;
    record?: boolean;
    labelHidden?: boolean;
    options: readonly { value: string; label: string }[];
    onValueChange?: (value: string) => void;
  },
) {
  const select = { ...props };
  Reflect.deleteProperty(select, "label");
  Reflect.deleteProperty(select, "options");
  Reflect.deleteProperty(select, "onValueChange");
  Reflect.deleteProperty(select, "record");
  Reflect.deleteProperty(select, "labelHidden");
  const generated = useId();
  const id = props.id ?? generated;

  return (
    <label htmlFor={id} {...stylex.props(styles.field, props.record && styles.recordField)}>
      <span
        {...stylex.props(
          styles.label,
          props.record && styles.secondaryLabel,
          props.labelHidden && styles.hiddenLabel,
        )}
      >
        {props.label}
      </span>
      <select
        {...select}
        id={id}
        onChange={(event) => props.onValueChange?.(event.currentTarget.value)}
        {...stylex.props(styles.control, props.record && styles.recordControl)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PlainFacts({
  facts,
  align,
  presentation,
  compact,
}: {
  compact?: boolean;
  presentation?: "record";
  align?: "end";
  facts: readonly { label: string; renderLabel?: ReactNode; value: ReactNode }[];
}) {
  return (
    <dl
      {...stylex.props(
        styles.facts,
        presentation === "record" && styles.recordFacts,
        compact && styles.compactFacts,
      )}
    >
      {facts.map((fact) => (
        <div
          key={fact.label}
          {...stylex.props(
            styles.fact,
            align === "end" && styles.wideFact,
            compact && styles.recordFact,
          )}
        >
          <dt {...stylex.props(styles.term, presentation === "record" && styles.recordTerm)}>
            {fact.label}
          </dt>
          <dd
            {...stylex.props(
              styles.value,
              align === "end" && styles.endValue,
              presentation === "record" && styles.recordFont,
            )}
          >
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function FactsGroup({ children }: { children: ReactNode }) {
  return <dl {...stylex.props(styles.facts)}>{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.fact)}>
      <dt {...stylex.props(styles.term)}>{label}</dt>
      <dd {...stylex.props(styles.value)}>{children}</dd>
    </div>
  );
}

export function ActionRow({
  children,
  spread,
  padded,
}: {
  children: ReactNode;
  spread?: boolean;
  padded?: boolean;
}) {
  return (
    <div
      {...stylex.props(
        styles.actions,
        spread && styles.spreadActions,
        padded && styles.paddedActions,
      )}
    >
      {children}
    </div>
  );
}

export function FormLink({ href, children }: { href: string; children?: ReactNode }) {
  return <InlineAction render={<a href={href} />}>{children}</InlineAction>;
}

export function FormAction({
  children,
  disabled,
  onClick,
  variant,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  variant?: "outline";
}) {
  return (
    <Action
      kind={variant === "outline" ? "secondary" : "primary"}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Action>
  );
}

export function NavigationLink(props: ComponentProps<"a">) {
  return <a {...props} />;
}

export function RecordHeader({ children, roomy }: { children: ReactNode; roomy?: boolean }) {
  return <header {...stylex.props(styles.header, roomy && styles.recordHeader)}>{children}</header>;
}

export function RecordSection({
  label,
  children,
  compact,
}: {
  label: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <section {...stylex.props(styles.recordSection, compact && styles.compactSection)}>
      <h3 {...stylex.props(styles.recordLabel, compact && styles.secondaryLabel)}>{label}</h3>
      {children}
    </section>
  );
}

export function FactDisclosure({
  summary,
  label,
  children,
}: {
  summary: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <details>
      <summary aria-label={label} {...stylex.props(styles.disclosureSummary)}>
        {summary}
      </summary>
      {children}
    </details>
  );
}

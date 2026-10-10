import * as stylex from "@stylexjs/stylex";
import { useId, type ReactNode } from "react";
import { kanon } from "@open-erp/ui/theme/kanon.stylex";
import { access } from "@open-erp/ui/theme/access.stylex";

const styles = stylex.create({
  page: {
    minHeight: "100dvh",
    backgroundColor: kanon.colorSideSurface,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: kanon.space4,
    fontFamily: kanon.fontUi,
    color: kanon.colorText,
    overflowWrap: "anywhere",
  },
  card: {
    width: kanon.sizeDialog,
    maxWidth: "100%",
    padding: access.padding,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: kanon.colorRule,
    borderRadius: access.radius,
    backgroundColor: kanon.colorSurface,
    display: "flex",
    flexDirection: "column",
    gap: kanon.space5,
    minWidth: 0,
  },
  header: { display: "flex", flexDirection: "column", gap: access.headerGap },
  title: {
    margin: 0,
    fontSize: access.titleSize,
    lineHeight: access.titleLeading,
    letterSpacing: access.titleTracking,
    fontWeight: kanon.weightSemibold,
  },
  group: { display: "flex", flexDirection: "column", gap: kanon.space1, minWidth: 0 },
  label: {
    color: kanon.colorSecondary,
    fontSize: kanon.textCaption,
    lineHeight: kanon.leadingBody,
    fontWeight: kanon.weightSemibold,
  },
  value: { fontSize: kanon.textBody, lineHeight: kanon.leadingSection },
  identity: { fontWeight: kanon.weightMedium },
  secondary: { color: kanon.colorSecondary },
  scope: {
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: kanon.colorRule,
    paddingTop: kanon.space4,
    display: "flex",
    flexDirection: "column",
    gap: kanon.space3,
  },
  note: {
    fontFamily: access.bodyFont,
    display: "flex",
    flexDirection: "column",
    gap: kanon.space2,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingSection,
  },
  actions: {
    display: "flex",
    justifyContent: "end",
    flexWrap: "wrap",
    gap: kanon.space2,
    paddingTop: kanon.space1,
  },
  select: {
    width: "100%",
    minWidth: 0,
    height: kanon.sizeButton,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: kanon.colorControl,
    borderRadius: kanon.radiusControl,
    backgroundColor: kanon.colorSurface,
    color: kanon.colorText,
    fontFamily: access.bodyFont,
    fontSize: kanon.textBody,
    paddingInline: kanon.space25,
    ":focus-visible": {
      outlineColor: kanon.colorAction,
      outlineStyle: "solid",
      outlineWidth: 2,
      outlineOffset: 2,
    },
  },
});

export function AccessPanel(props: { title: string; children: ReactNode }) {
  return (
    <main {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.card)}>
        <header {...stylex.props(styles.header)}>
          <h1 {...stylex.props(styles.title)}>{props.title}</h1>
        </header>
        {props.children}
      </section>
    </main>
  );
}

export function AccessIdentity(props: { name: string; host: string }) {
  return (
    <div {...stylex.props(styles.group)}>
      <span {...stylex.props(styles.label)}>App</span>
      <span {...stylex.props(styles.value, styles.identity)}>{props.name}</span>
      <span {...stylex.props(styles.value, styles.secondary)}>{props.host}</span>
    </div>
  );
}

export function AccessScope(props: { children: ReactNode }) {
  return <div {...stylex.props(styles.scope)}>{props.children}</div>;
}

export function AccessFact(props: { label: string; value: string }) {
  return (
    <div {...stylex.props(styles.group)}>
      <span {...stylex.props(styles.label)}>{props.label}</span>
      <span {...stylex.props(styles.value)}>{props.value}</span>
    </div>
  );
}

export function AccessField(props: {
  label: string;
  value: string;
  placeholder: string;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();

  return (
    <div {...stylex.props(styles.group)}>
      <label htmlFor={id} {...stylex.props(styles.label)}>
        {props.label}
      </label>
      <select
        id={id}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        {...stylex.props(styles.select)}
      >
        <option value="">{props.placeholder}</option>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AccessNote(props: { children: ReactNode; secondary?: string }) {
  return (
    <div {...stylex.props(styles.note)}>
      <span>{props.children}</span>
      {props.secondary ? <span {...stylex.props(styles.secondary)}>{props.secondary}</span> : null}
    </div>
  );
}

export function AccessActions(props: { children: ReactNode }) {
  return <div {...stylex.props(styles.actions)}>{props.children}</div>;
}

export function AccessStatus(props: { children: ReactNode }) {
  return (
    <div role="status" {...stylex.props(styles.note)}>
      {props.children}
    </div>
  );
}

import { useId, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { Disclosure } from "@open-erp/ui/components/workflow";

const styles = stylex.create({
  root: {
    minWidth: 0,
    containerType: "inline-size",
    marginBlockStart: tokens.spaceNegative4,
    marginInline: { default: -20, "@media (max-width: 767px)": -16 },
  },
  heading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: tokens.space2,
    minHeight: 48,
    paddingInline: { default: tokens.space8, "@media (max-width: 767px)": tokens.space4 },
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  title: { fontSize: tokens.fontSizeBase, fontWeight: tokens.fontWeightSemibold, margin: 0 },
  actions: { display: "flex", gap: tokens.space2, flexWrap: "wrap", minWidth: 0 },
  compactNavigation: {
    display: { default: "none", "@media (max-width: 767px)": "contents" },
  },
  headingStart: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: tokens.space6,
    minWidth: 0,
  },
  filters: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: tokens.space2,
    minHeight: 40,
    paddingInline: { default: tokens.space8, "@media (max-width: 767px)": tokens.space4 },
    paddingBlock: tokens.space1,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  search: { minWidth: 0, flex: "1 1 160px" },
  columns: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) 420px",
      "@container (max-width: 960px)": "minmax(0, 1fr)",
    },
    minWidth: 0,
    alignItems: "stretch",
    minHeight: "calc(100dvh - 48px)",
  },
  list: { minWidth: 0 },
  group: {
    display: "flex",
    alignItems: "end",
    gap: tokens.space2,
    minHeight: 52,
    paddingBlockEnd: tokens.space2,
    paddingInline: { default: tokens.space8, "@media (max-width: 767px)": tokens.space4 },
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    margin: 0,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
  },
  count: {
    backgroundColor: tokens.muted,
    borderRadius: tokens.radiusFull,
    paddingInline: tokens.space1_75,
  },
  firstGroup: { minHeight: 40 },
  row: {
    display: "grid",
    gridTemplateColumns: {
      default: "16px minmax(0, 1fr) 150px 100px",
      "@container (max-width: 640px)": "16px minmax(0, 1fr) minmax(88px, 120px)",
    },
    alignItems: "center",
    gap: tokens.space1_5,
    minHeight: 52,
    width: "100%",
    paddingInline: { default: tokens.space8, "@media (max-width: 767px)": tokens.space4 },
    paddingBlock: tokens.space2,
    borderWidth: 0,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    backgroundColor: { default: "transparent", ":hover": tokens.mutedAlpha30 },
    color: tokens.foreground,
    textAlign: "start",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    cursor: "pointer",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRingInset },
  },
  selected: { backgroundColor: tokens.registerSelected, boxShadow: tokens.selectionIndicator },
  rowBody: { minWidth: 0, display: "grid", gap: tokens.space0_5 },
  ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  caption: { color: tokens.mutedForeground, fontSize: tokens.fontSizeXs },
  status: { minWidth: 0, overflowWrap: "anywhere" },
  date: {
    textAlign: "end",
    color: tokens.mutedForeground,
    display: { default: "block", "@container (max-width: 640px)": "none" },
  },
  warning: { color: tokens.warningForeground },
  success: { color: tokens.successForeground },
  detail: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.space5,
    minWidth: 0,
    padding: tokens.space7,
    backgroundColor: tokens.card,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.border,
    overflowWrap: "anywhere",
    "@container (max-width: 960px)": {
      borderInlineStartWidth: 0,
      borderBlockStartWidth: 1,
      borderBlockStartStyle: "solid",
      borderBlockStartColor: tokens.border,
    },
    "@media (max-width: 767px)": { padding: tokens.space4 },
  },
  detailTitle: {
    margin: 0,
    fontSize: tokens.fontSizeDisplaySmall,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight40Px,
    letterSpacing: tokens.trackingSerif,
  },
  detailHeader: { display: "grid", gap: tokens.space1 },
  detailSection: { display: "grid", gap: tokens.space2, minWidth: 0 },
  detailLabel: {
    fontSize: tokens.fontSizeXs,
    color: tokens.mutedForeground,
    fontWeight: tokens.fontWeightSemibold,
    margin: 0,
  },
  facts: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusLg,
    padding: tokens.space3,
    display: "grid",
    gap: tokens.space3,
  },
  detailActions: { marginBlockStart: "auto", display: "grid", gap: tokens.space2 },
  footer: {
    paddingInline: { default: tokens.space8, "@media (max-width: 767px)": tokens.space4 },
    paddingBlockEnd: tokens.space4,
  },
});

export function PortfolioCompactNavigation({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.compactNavigation)}>{children}</div>;
}

export function PortfolioFrame(props: {
  title: string;
  actions: ReactNode;
  search: ReactNode;
  filters: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.root)}>
      <header {...stylex.props(styles.heading)}>
        <div {...stylex.props(styles.headingStart)}>
          <h1 {...stylex.props(styles.title)}>{props.title}</h1>
          {props.filters}
        </div>
        <div {...stylex.props(styles.actions)}>{props.actions}</div>
      </header>
      <div {...stylex.props(styles.columns)}>
        <div {...stylex.props(styles.list)}>
          <div {...stylex.props(styles.filters)}>
            <div {...stylex.props(styles.search)}>{props.search}</div>
          </div>
          {props.children}
          <div {...stylex.props(styles.footer)}>{props.footer}</div>
        </div>
        {props.detail}
      </div>
    </div>
  );
}

export function PortfolioGroup(props: {
  title: string;
  total: number;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={props.title}>
      <h2 {...stylex.props(styles.group, props.first && styles.firstGroup)}>
        {props.title} <span {...stylex.props(styles.count)}>{props.total}</span>
      </h2>
      {props.children}
    </section>
  );
}

export function PortfolioRow(props: {
  name: string;
  secondary: string;
  status: ReactNode;
  date: string;
  icon: ReactNode;
  tone: "warning" | "success" | "neutral";
  selected: boolean;
  onSelect: () => void;
}) {
  const descriptionId = useId();

  return (
    <button
      type="button"
      aria-label={props.name}
      aria-describedby={`${descriptionId}-secondary ${descriptionId}-status ${descriptionId}-date`}
      aria-pressed={props.selected}
      onClick={props.onSelect}
      {...stylex.props(styles.row, props.selected && styles.selected)}
    >
      <span
        aria-hidden="true"
        {...stylex.props(
          props.tone === "warning" && styles.warning,
          props.tone === "success" && styles.success,
        )}
      >
        {props.icon}
      </span>
      <span {...stylex.props(styles.rowBody)}>
        <span {...stylex.props(styles.ellipsis)}>{props.name}</span>
        <span id={`${descriptionId}-secondary`} {...stylex.props(styles.ellipsis, styles.caption)}>
          {props.secondary}
        </span>
      </span>
      <span
        id={`${descriptionId}-status`}
        {...stylex.props(
          styles.status,
          props.tone === "warning" && styles.warning,
          props.tone === "success" && styles.success,
        )}
      >
        {props.status}
      </span>
      <span id={`${descriptionId}-date`} {...stylex.props(styles.date)}>
        {props.date}
      </span>
    </button>
  );
}

export function PortfolioDetailPanel(props: {
  label: string;
  title?: string;
  eyebrow?: ReactNode;
  name?: string;
  lead?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section aria-label={props.label} {...stylex.props(styles.detail)}>
      {props.title ? (
        <div {...stylex.props(styles.detailHeader)}>
          {props.eyebrow}
          <h2 {...stylex.props(styles.detailTitle)}>{props.title}</h2>
          {props.name ? <span>{props.name}</span> : null}
          {props.lead ? <span {...stylex.props(styles.caption)}>{props.lead}</span> : null}
        </div>
      ) : null}
      {props.children}
      {props.actions ? <div {...stylex.props(styles.detailActions)}>{props.actions}</div> : null}
    </section>
  );
}

export function PortfolioDetailSection(props: {
  title: string;
  region?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={props.region} {...stylex.props(styles.detailSection)}>
      <h3 {...stylex.props(styles.detailLabel)}>{props.title}</h3>
      {props.children}
    </section>
  );
}

export function PortfolioFactList({
  facts,
}: {
  facts: readonly { id: string; label: string; detail: string }[];
}) {
  return (
    <ul {...stylex.props(styles.facts)}>
      {facts.map((fact) => (
        <li key={fact.id}>
          <Disclosure title={fact.label} compact>
            {fact.detail}
          </Disclosure>
        </li>
      ))}
    </ul>
  );
}

// Adapted from Accounted UI v2: DashboardContent, AttGoraSection and journal table primitives.
// Copyright (C) 2025-2026 Jakob Wennberg. See licenses/accounted-LICENSE.
import type { ComponentProps, ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Link } from "@open-erp/ui/components/link";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  body: { display: "grid", gap: 24, minWidth: 0 },
  welcome: { paddingBlock: "16px 8px" },
  greeting: {
    fontFamily: tokens.fontSerif,
    fontSize: tokens.fontSize2xl,
    fontWeight: tokens.fontWeightNormal,
    lineHeight: tokens.lineHeight32Px,
    letterSpacing: tokens.trackingSerif,
  },
  context: {
    marginBlockStart: 6,
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight20Px,
  },
  columns: {
    display: "grid",
    gap: 40,
    alignItems: "start",
    gridTemplateColumns: {
      default: "minmax(0, 1.5fr) minmax(0, 1fr)",
      "@container (max-width: 52rem)": "minmax(0, 1fr)",
    },
  },
  section: { minWidth: 0 },
  sectionTitle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightMedium,
    paddingBlockEnd: 12,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  sectionLabel: {
    fontSize: tokens.fontSizeCompact,
    fontWeight: tokens.fontWeightMedium,
    textTransform: "uppercase",
    letterSpacing: tokens.trackingSection,
    color: tokens.mutedForeground,
    padding: "20px 4px 4px",
  },
  list: { display: "grid", minWidth: 0 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
    padding: "14px 4px",
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    textDecoration: "none",
    color: tokens.foreground,
    backgroundColor: { default: "transparent", ":hover": tokens.mutedAlpha30 },
    transitionProperty: "background-color",
    transitionDuration: tokens.durationQuick,
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRingInset },
  },
  rowIcon: {
    color: tokens.mutedForeground,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    width: 18,
  },
  rowBody: { flexGrow: 1, minWidth: 0 },
  rowTitle: {
    fontSize: tokens.fontSizeTask,
    lineHeight: tokens.lineHeight20Px,
    overflowWrap: "anywhere",
  },
  rowDetail: {
    display: "block",
    marginBlockStart: 2,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight18Px,
    color: tokens.mutedForeground,
    overflowWrap: "anywhere",
  },
  rowValue: {
    fontSize: tokens.fontSizeXs,
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
    flexShrink: 0,
  },
  empty: { display: "grid", justifyItems: "start", gap: 8, padding: "40px 4px", maxWidth: "34rem" },
  emptyTitle: {
    fontFamily: tokens.fontSerif,
    fontSize: tokens.fontSizeEmptyTitle,
    lineHeight: tokens.lineHeight30Px,
    fontWeight: tokens.fontWeightNormal,
  },
  emptyDetail: {
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight21Px,
    color: tokens.mutedForeground,
    textWrap: "pretty",
  },
  action: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightMedium,
    lineHeight: tokens.lineHeight20Px,
    minHeight: 32,
    borderRadius: tokens.radiusMd,
    paddingInline: 12,
    color: tokens.primaryForeground,
    backgroundColor: { default: tokens.primary, ":hover": tokens.primaryHoverBackground },
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    textDecoration: "none",
    whiteSpace: "normal",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
    "@media (pointer: coarse)": { minHeight: 44 },
  },
  quiet: {
    backgroundColor: { default: "transparent", ":hover": tokens.muted },
    color: tokens.foreground,
    borderColor: tokens.border,
  },
  record: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minHeight: 32,
    marginBlock: -8,
    font: "inherit",
    backgroundColor: "transparent",
    borderWidth: 0,
    color: tokens.foreground,
    cursor: "pointer",
    textAlign: "start",
    borderRadius: tokens.radiusSmallControl,
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  openRecord: {
    minHeight: 40,
    gap: 8,
    paddingInline: 4,
    fontWeight: tokens.fontWeightMedium,
    backgroundColor: { default: "transparent", ":hover": tokens.muted },
  },
  choices: { display: "flex", flexWrap: "wrap", gap: 4, minWidth: 0 },
  choice: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: tokens.radiusMd,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeControl,
    cursor: "pointer",
    color: { default: tokens.mutedForeground, ":hover": tokens.foreground },
    backgroundColor: { default: "transparent", ":hover": tokens.muted },
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  selectedChoice: {
    borderColor: tokens.borderActive,
    backgroundColor: tokens.secondary,
    color: tokens.foreground,
    fontWeight: tokens.fontWeightMedium,
  },
  muted: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight20Px,
  },
  filter: { width: "min(100%, 230px)", minWidth: 0 },
  filters: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 },
  search: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.background,
    color: tokens.foreground,
    paddingInline: 10,
    minHeight: 36,
    width: "min(100%, 280px)",
    fontSize: tokens.fontSizeControl,
    ":focus-visible": { outline: "none", boxShadow: tokens.controlFocusShadow },
    "@media (pointer: coarse)": { minHeight: 44, fontSize: tokens.fontSizeBase },
  },
});
export function PageContent({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.body)}>{children}</div>;
}
export function WorkspaceWelcome({ title, context }: { title: string; context: string }) {
  return (
    <div {...stylex.props(styles.welcome)}>
      <h2 {...stylex.props(styles.greeting)}>{title}</h2>
      <p {...stylex.props(styles.context)}>{context}</p>
    </div>
  );
}
export function TaskColumns({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.columns)}>{children}</div>;
}
export function TaskSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionTitle)}>
        <h2>{title}</h2>
        {action}
      </div>
      <div {...stylex.props(styles.list)}>{children}</div>
    </section>
  );
}
export function TaskBand({ children }: { children: ReactNode }) {
  return <h3 {...stylex.props(styles.sectionLabel)}>{children}</h3>;
}
export function TaskRow(props: {
  href: string;
  icon: ReactNode;
  title: string;
  detail: string;
  value?: string;
}) {
  return (
    <Link href={props.href} {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.rowIcon)}>{props.icon}</span>
      <span {...stylex.props(styles.rowBody)}>
        <span {...stylex.props(styles.rowTitle)}>{props.title}</span>
        <span {...stylex.props(styles.rowDetail)}>{props.detail}</span>
      </span>
      {props.value ? <span {...stylex.props(styles.rowValue)}>{props.value}</span> : null}
      <ChevronRight size={14} aria-hidden="true" />
    </Link>
  );
}
export function PageEmpty({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.empty)}>
      <h2 {...stylex.props(styles.emptyTitle)}>{title}</h2>
      {detail ? <p {...stylex.props(styles.emptyDetail)}>{detail}</p> : null}
      {children}
    </div>
  );
}
export function PageAction({
  quiet = false,
  ...props
}: ComponentProps<typeof Link> & { quiet?: boolean }) {
  return <Link {...props} {...stylex.props(styles.action, quiet && styles.quiet)} />;
}
export function RecordToggle({
  children,
  expanded,
  ...props
}: ComponentProps<"button"> & { expanded: boolean }) {
  return (
    <button {...props} type="button" aria-expanded={expanded} {...stylex.props(styles.record)}>
      {expanded ? (
        <ChevronDown size={14} aria-hidden="true" />
      ) : (
        <ChevronRight size={14} aria-hidden="true" />
      )}
      {children}
    </button>
  );
}
export function RecordOpen({ children, ...props }: ComponentProps<"button">) {
  return (
    <button {...props} type="button" {...stylex.props(styles.record, styles.openRecord)}>
      {children}
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  );
}
export function RegisterChoices({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onValueChange: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} {...stylex.props(styles.choices)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onValueChange(option.value)}
          {...stylex.props(styles.choice, value === option.value && styles.selectedChoice)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
export function PageCaption(props: ComponentProps<"p">) {
  return <p {...props} {...stylex.props(styles.muted)} />;
}
export function RegisterFilters({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.filters)}>{children}</div>;
}
export function RegisterSearch(props: Omit<ComponentProps<"input">, "style" | "className">) {
  return <input {...props} type="search" {...stylex.props(styles.search)} />;
}

export function RegisterFilter({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.filter)}>{children}</div>;
}

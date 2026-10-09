import { type ComponentProps, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@open-erp/ui/components/button";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  navItem: {
    color: { default: tokens.mutedForeground, ":hover": tokens.foreground },
    fontSize: tokens.fontSizeControl,
    justifyContent: "start",
    minHeight: 28,
    lineHeight: tokens.lineHeight16Px,
    paddingInline: tokens.space2,
    whiteSpace: "normal",
    textAlign: "start",
    width: "100%",
    "@media (pointer: coarse)": { minHeight: 44 },
    "@media (max-width: 767px)": { minHeight: 44 },
  },
  navActive: {
    backgroundColor: { default: tokens.muted, ":hover": tokens.muted },
    color: { default: tokens.mutedForeground, ":hover": tokens.foreground },
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space3,
    minHeight: 48,
    position: "sticky",
    insetBlockStart: 0,
    zIndex: 10,
    backgroundColor: tokens.card,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    paddingInline: { default: 20, "@media (max-width: 767px)": 16 },
    paddingBlock: 8,
    marginInline: { default: -20, "@media (max-width: 767px)": -16 },
    marginBlockStart: -16,
    marginBlockEnd: 16,
  },
  title: {
    fontSize: tokens.fontSizeBase,
    lineHeight: tokens.lineHeight20Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  navigationHeader: { paddingBlock: 0 },
  headerHeading: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.space4_5,
    minWidth: 0,
  },
  scope: { display: "flex", alignItems: "center", gap: tokens.space2, minWidth: 0 },
  toolbar: {
    display: "flex",
    alignItems: "end",
    flexWrap: "wrap",
    gap: tokens.space3,
    marginBlockEnd: 0,
  },
  panel: { display: "grid", gap: tokens.space4, minWidth: 0 },
  plain: { padding: 0 },
  metrics: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(auto-fit, minmax(9rem, 1fr))",
      "@media (max-width: 959px)": "repeat(2, minmax(0, 1fr))",
    },
    backgroundColor: tokens.card,
    borderRadius: tokens.radiusSurface,
    boxShadow: tokens.shadowRaised,
  },
  metric: {
    display: "grid",
    alignContent: "start",
    gap: tokens.space2,
    paddingBlock: tokens.space4,
    paddingInline: tokens.space4,
    minWidth: 0,
    borderInlineStartWidth: { default: 1, "@media (max-width: 959px)": 0 },
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.border,
    ":first-child": { borderInlineStartWidth: 0, paddingInlineStart: tokens.space4 },
    "@media (max-width: 959px)": {
      paddingInline: tokens.space4,
      paddingBlock: tokens.space4,
      borderBlockEndWidth: 1,
      borderBlockEndStyle: "solid",
      borderBlockEndColor: tokens.border,
    },
    ":last-child": { borderBlockEndWidth: 0 },
  },
  wideMetric: { gridColumn: { "@media (max-width: 959px)": "1 / -1" } },
  reportLink: {
    justifyContent: "start",
    textAlign: "start",
    minHeight: tokens.space10,
    minWidth: 0,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    fontSize: tokens.fontSizeSm,
    paddingInline: tokens.space2,
    marginInlineStart: `calc(-1 * ${tokens.space2})`,
  },
  metricLink: {
    fontSize: "inherit",
    fontWeight: "inherit",
    lineHeight: "inherit",
    color: { default: tokens.foreground, ":hover": tokens.accentForeground },
    padding: 0,
    minHeight: tokens.space10,
    justifyContent: "start",
    whiteSpace: "normal",
    textAlign: "start",
  },
  metricLabel: {
    minHeight: { "@media (max-width: 399px)": "2lh" },
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightMedium,
  },
  metricValue: {
    fontSize: tokens.fontSize3xl,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: tokens.trackingDisplay,
    lineHeight: tokens.lineHeightTitle,
    overflowWrap: "anywhere",
  },
  metricCaption: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    fontVariantNumeric: "tabular-nums",
    textWrap: "pretty",
  },
});

export function WorkspaceScope({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.scope)}>{children}</div>;
}

export function WorkspaceNavItem({
  active = false,
  ...props
}: Omit<ComponentProps<typeof Button>, "styleX" | "variant" | "size"> & { active?: boolean }) {
  return (
    <Button
      {...props}
      variant="ghost"
      size="xl"
      aria-current={active ? "page" : undefined}
      styleX={[styles.navItem, active && styles.navActive]}
    />
  );
}

export function WorkspaceHeader({
  title,
  action,
  navigation,
}: {
  title: string;
  action?: ReactNode;
  navigation?: ReactNode;
}) {
  return (
    <header {...stylex.props(styles.header, Boolean(navigation) && styles.navigationHeader)}>
      <div {...stylex.props(styles.headerHeading)}>
        <h1 {...stylex.props(styles.title)}>{title}</h1>
        {navigation}
      </div>
      {action}
    </header>
  );
}

export function WorkspaceToolbar(props: Omit<ComponentProps<"form">, "className" | "style">) {
  return <form {...props} {...stylex.props(styles.toolbar)} />;
}

export function WorkspacePanel({
  children,
  plain = false,
  ...props
}: Omit<ComponentProps<"section">, "className" | "style"> & { plain?: boolean }) {
  return (
    <section {...props} {...stylex.props(styles.panel, plain && styles.plain)}>
      {children}
    </section>
  );
}

export function MetricGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <dl aria-label={label} {...stylex.props(styles.metrics)}>
      {children}
    </dl>
  );
}

export function Metric({
  label,
  value,
  caption,
  onClick,
  fullWidthOnMobile = false,
}: {
  label: string;
  value: string;
  caption: ReactNode;
  onClick?: () => void;
  fullWidthOnMobile?: boolean;
}) {
  return (
    <div {...stylex.props(styles.metric, fullWidthOnMobile && styles.wideMetric)}>
      <dt {...stylex.props(styles.metricLabel)}>{label}</dt>
      <dd {...stylex.props(styles.metricValue)}>
        {onClick ? (
          <Button
            variant="unstyled"
            onClick={onClick}
            aria-label={`${label}: ${value}`}
            styleX={styles.metricLink}
          >
            {value}
          </Button>
        ) : (
          value
        )}
      </dd>
      <dd {...stylex.props(styles.metricCaption)}>{caption}</dd>
    </div>
  );
}

export function ReportLink(props: Omit<ComponentProps<typeof Button>, "styleX" | "variant">) {
  return <Button {...props} variant="ghost" styleX={styles.reportLink} />;
}

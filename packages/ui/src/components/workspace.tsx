import type { ComponentProps, ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@open-erp/ui/components/button";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  shell: {
    "--card": tokens.workspaceSurface,
    display: "grid",
    gridTemplateColumns: {
      default: "14rem minmax(0, 1fr)",
      "@media (max-width: 959px)": "minmax(0, 1fr)",
    },
    minHeight: "100svh",
  },
  sidebar: {
    backgroundColor: tokens.sidebar,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: tokens.border,
    display: { default: "flex", "@media (max-width: 959px)": "none" },
    flexDirection: "column",
    gap: tokens.space4,
    height: "100svh",
    insetBlockStart: 0,
    overflowY: "auto",
    padding: tokens.space4,
    position: "sticky",
  },
  brand: {
    alignItems: "center",
    display: "flex",
    gap: tokens.space3,
    paddingBlock: tokens.space2,
    paddingInline: tokens.space2,
  },
  brandName: {
    fontSize: tokens.fontSizeLg,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: tokens.trackingHeading,
  },
  brandDetail: { color: tokens.mutedForeground, fontSize: tokens.fontSizeXs },
  navGroup: { marginBlockEnd: tokens.space4 },
  navigation: { display: "grid", gap: tokens.space1 },
  navigationLabel: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightMedium,
    paddingInline: tokens.space3,
    marginBlockEnd: tokens.space2,
  },
  navItem: {
    color: { default: tokens.mutedForeground, ":hover": tokens.foreground },
    fontSize: tokens.fontSizeSm,
    justifyContent: "start",
    minHeight: tokens.space10,
    paddingInline: tokens.space3,
    whiteSpace: "normal",
    textAlign: "start",
    width: "100%",
  },
  navActive: {
    backgroundColor: { default: tokens.sidebarAccent, ":hover": tokens.sidebarAccent },
    color: { default: tokens.accentForeground, ":hover": tokens.accentForeground },
    fontWeight: tokens.fontWeightSemibold,
  },
  footer: {
    display: "grid",
    gap: tokens.space3,
    marginBlockStart: "auto",
    paddingInline: tokens.space2,
  },
  body: { minWidth: 0, backgroundColor: tokens.background },
  topbar: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.space3,
    justifyContent: "space-between",
    minHeight: "4rem",
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    paddingInline: { default: tokens.space8, "@media (max-width: 599px)": tokens.space4 },
    paddingBlock: tokens.space2,
  },
  mobile: {
    display: { default: "none", "@media (max-width: 959px)": "block" },
    marginBlockEnd: tokens.space6,
  },
  content: {
    marginInline: "auto",
    maxWidth: "100rem",
    minWidth: 0,
    padding: { default: tokens.space8, "@media (max-width: 599px)": tokens.space4 },
    paddingBlockEnd: tokens.space12,
  },
  header: { display: "grid", gap: tokens.space2, marginBlockEnd: tokens.space6 },
  toolbar: {
    display: "grid",
    alignItems: "end",
    gap: tokens.space3,
    gridTemplateColumns: {
      default: "minmax(10rem, 1.4fr) repeat(2, minmax(9rem, 1fr)) auto",
      "@media (max-width: 1199px)": "repeat(2, minmax(0, 1fr))",
      "@media (max-width: 399px)": "minmax(0, 1fr)",
    },
    marginBlockEnd: 0,
    maxWidth: "64rem",
  },
  panel: {
    backgroundColor: tokens.card,
    borderRadius: tokens.radiusSurface,
    boxShadow: tokens.shadowRaised,
    display: "grid",
    gap: tokens.space4,
    minWidth: 0,
    padding: tokens.space4,
  },
  plain: { backgroundColor: "transparent", boxShadow: "none", padding: 0, borderRadius: 0 },
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

/** Persistent desktop navigation, with an equivalent compact navigation slot below 960px. */
export function Workspace({
  brand,
  navigation,
  footer,
  topbar,
  mobileNavigation,
  children,
}: {
  brand: ReactNode;
  navigation: ReactNode;
  footer: ReactNode;
  topbar: ReactNode;
  mobileNavigation: ReactNode;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.shell)}>
      <aside {...stylex.props(styles.sidebar)}>
        {brand}
        {navigation}
        <div {...stylex.props(styles.footer)}>{footer}</div>
      </aside>
      <div {...stylex.props(styles.body)}>
        <header {...stylex.props(styles.topbar)}>{topbar}</header>
        <main id="workspace-content" {...stylex.props(styles.content)}>
          <div {...stylex.props(styles.mobile)}>{mobileNavigation}</div>
          {children}
        </main>
      </div>
    </div>
  );
}

export function WorkspaceBrand({
  icon,
  name,
  detail,
}: {
  icon: ReactNode;
  name: string;
  detail: string;
}) {
  return (
    <div {...stylex.props(styles.brand)}>
      {icon}
      <div>
        <p {...stylex.props(styles.brandName)}>{name}</p>
        <p {...stylex.props(styles.brandDetail)}>{detail}</p>
      </div>
    </div>
  );
}

export function WorkspaceNavigation({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} {...stylex.props(styles.navGroup)}>
      <p {...stylex.props(styles.navigationLabel)}>{label}</p>
      <div {...stylex.props(styles.navigation)}>{children}</div>
    </nav>
  );
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

export function WorkspaceHeader({ children }: { children: ReactNode }) {
  return <header {...stylex.props(styles.header)}>{children}</header>;
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

/** A consistently aligned drill-down control for report rows. */
export function ReportLink(props: Omit<ComponentProps<typeof Button>, "styleX" | "variant">) {
  return <Button {...props} variant="ghost" styleX={styles.reportLink} />;
}

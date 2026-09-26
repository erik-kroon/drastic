import { Dialog } from "@base-ui/react/dialog";
import { useState, useRef, useLayoutEffect, type ComponentProps, type ReactNode } from "react";
import { Menu, X, ChevronDown } from "lucide-react";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  shell: {
    display: "grid",
    gridTemplateColumns: {
      default: "220px minmax(0, 1fr)",
      "@media (max-width: 767px)": "minmax(0, 1fr)",
    },
    backgroundColor: tokens.sidebar,
    minHeight: "100dvh",
  },
  sidebar: {
    display: { default: "flex", "@media (max-width: 767px)": "none" },
    flexDirection: "column",
    height: "100dvh",
    insetBlockStart: 0,
    overflowY: "auto",
    paddingInline: tokens.space3,
    paddingBlock: tokens.space3,
    position: "sticky",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space2,
    paddingInline: tokens.space2,
    paddingBlock: tokens.space1,
    marginBlockEnd: tokens.space6,
  },
  brandName: {
    fontSize: tokens.fontSizeBrand,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: tokens.trackingHeading,
  },
  brandDetail: { color: tokens.mutedForeground, fontSize: tokens.fontSizeXs },
  navGroup: { marginBlockEnd: tokens.space4 },
  navigation: { display: "grid", gap: 1 },
  navigationLabel: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSize2xs,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: tokens.trackingSection,
    textTransform: "uppercase",
    paddingInline: tokens.space3,
    marginBlockEnd: tokens.space1,
  },
  navItem: {
    color: { default: tokens.mutedForeground, ":hover": tokens.foreground },
    fontSize: tokens.fontSizeControl,
    justifyContent: "start",
    minHeight: 34,
    paddingInline: tokens.space3,
    whiteSpace: "normal",
    textAlign: "start",
    width: "100%",
    "@media (pointer: coarse)": { minHeight: 44 },
    "@media (max-width: 767px)": { minHeight: 44 },
  },
  navLink: {
    alignItems: "center",
    borderRadius: tokens.radiusSurface,
    display: "flex",
    gap: 10,
    paddingBlock: 7,
    textDecoration: "none",
    backgroundColor: { default: "transparent", ":hover": tokens.muted },
    transitionProperty: "background-color, color",
    transitionDuration: tokens.durationQuick,
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  navActive: {
    backgroundColor: { default: tokens.secondary, ":hover": tokens.secondary },
    color: { default: tokens.foreground, ":hover": tokens.foreground },
    fontWeight: tokens.fontWeightMedium,
  },
  navSub: {
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.border,
    paddingInlineStart: 6,
    marginInlineStart: 19,
    marginBlock: 4,
    display: "grid",
    gap: 1,
  },
  footer: {
    display: "grid",
    gap: tokens.space2,
    marginBlockStart: "auto",
    paddingBlockStart: tokens.space4,
  },
  body: {
    minWidth: 0,
    backgroundColor: tokens.card,
    borderRadius: tokens.radiusOverlay,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    marginBlock: 10,
    marginInlineEnd: 10,
    height: "calc(100dvh - 20px)",
    overflowY: "auto",
    containerType: "inline-size",
    "@media (max-width: 767px)": {
      height: "auto",
      minHeight: "100dvh",
      borderWidth: 0,
      borderRadius: 0,
      margin: 0,
      overflowY: "visible",
    },
  },
  content: {
    minWidth: 0,
    paddingInline: { default: 24, "@media (max-width: 767px)": 16 },
    paddingBlockStart: 16,
    paddingBlockEnd: 32,
    "@media (max-width: 767px)": { paddingBlockEnd: "calc(88px + env(safe-area-inset-bottom))" },
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
    paddingInline: { default: 24, "@media (max-width: 767px)": 16 },
    paddingBlock: 8,
    marginInline: { default: -24, "@media (max-width: 767px)": -16 },
    marginBlockStart: -16,
    marginBlockEnd: 16,
  },
  title: {
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight20Px,
    fontWeight: tokens.fontWeightMedium,
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
  mobileBar: {
    display: { default: "none", "@media (max-width: 767px)": "flex" },
    alignItems: "stretch",
    position: "fixed",
    insetBlockEnd: 0,
    insetInline: 0,
    zIndex: 30,
    backgroundColor: tokens.card,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
    paddingBlockEnd: "env(safe-area-inset-bottom)",
    minHeight: 64,
  },
  mobileLink: {
    display: "flex",
    flexGrow: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: 64,
    fontSize: tokens.fontSizeCompact,
    color: tokens.mutedForeground,
    textDecoration: "none",
    backgroundColor: "transparent",
    borderWidth: 0,
    cursor: "pointer",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRingInset },
  },
  mobileActive: { color: tokens.foreground, fontWeight: tokens.fontWeightSemibold },
  backdrop: { position: "fixed", inset: 0, backgroundColor: tokens.menuBackdrop, zIndex: 40 },
  dialog: {
    position: "fixed",
    insetBlockEnd: 0,
    insetInline: 0,
    zIndex: 45,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusSheetTop,
    backgroundColor: tokens.card,
    color: tokens.foreground,
    padding: 16,
    margin: 0,
    marginBlockStart: "auto",
    width: "100%",
    maxWidth: "none",
    maxHeight: "85dvh",
    overflowY: "auto",
    paddingBlockEnd: "max(16px, env(safe-area-inset-bottom))",
    "::backdrop": { backgroundColor: tokens.menuBackdrop },
  },
  dialogHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBlockEnd: 16,
  },
  account: { position: "relative", fontSize: tokens.fontSizeControl, minWidth: 0 },
  accountSummary: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    listStyle: "none",
    borderRadius: tokens.radiusSurface,
    padding: 10,
    minHeight: 44,
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.secondary },
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  accountDetails: {
    display: "grid",
    gap: 12,
    padding: 12,
    marginBlockEnd: 8,
    backgroundColor: tokens.card,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusSurface,
  },
  accountName: {
    flexGrow: 1,
    minWidth: 0,
    overflowWrap: "anywhere",
    fontWeight: tokens.fontWeightMedium,
  },
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

/** Frame and navigation adapted from Accounted UI v2. See licenses/accounted-LICENSE. */
export function Workspace(props: {
  brand: ReactNode;
  navigation: ReactNode;
  footer: ReactNode;
  mobileNavigation: ReactNode;
  pageKey: string;
  children: ReactNode;
}) {
  const main = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [props.pageKey]);

  return (
    <div {...stylex.props(styles.shell)}>
      <aside {...stylex.props(styles.sidebar)}>
        {props.brand}
        {props.navigation}
        <div {...stylex.props(styles.footer)}>{props.footer}</div>
      </aside>
      <main ref={main} id="workspace-content" {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.content)}>{props.children}</div>
      </main>
      {props.mobileNavigation}
    </div>
  );
}

export function WorkspaceAccount({
  name,
  detail,
  children,
}: {
  name: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <details {...stylex.props(styles.account)}>
      <summary {...stylex.props(styles.accountSummary)}>
        <span {...stylex.props(styles.accountName)}>
          {name}
          <span {...stylex.props(styles.brandDetail)}>
            <br />
            {detail}
          </span>
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div {...stylex.props(styles.accountDetails)}>{children}</div>
    </details>
  );
}

export function WorkspaceSubnavigation({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.navSub)}>{children}</div>;
}

export function WorkspaceMobileNavigation(props: {
  label: string;
  closeLabel: string;
  items: { label: string; href: string; icon: ReactNode; active: boolean }[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <nav aria-label={props.label} {...stylex.props(styles.mobileBar)}>
        {props.items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            {...stylex.props(styles.mobileLink, item.active && styles.mobileActive)}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
        <Dialog.Trigger {...stylex.props(styles.mobileLink)}>
          <Menu size={20} strokeWidth={1.5} aria-hidden="true" />
          {props.label}
        </Dialog.Trigger>
      </nav>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup {...stylex.props(styles.dialog)}>
          <div {...stylex.props(styles.dialogHeader)}>
            <Dialog.Title>{props.label}</Dialog.Title>
            <Dialog.Close
              render={<Button static variant="ghost" size="icon" aria-label={props.closeLabel} />}
            >
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
            }}
          >
            {props.children}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function WorkspaceBrand({
  icon,
  name,
  detail,
}: {
  icon: ReactNode;
  name: string;
  detail?: string;
}) {
  return (
    <div {...stylex.props(styles.brand)}>
      {icon}
      <div>
        <p {...stylex.props(styles.brandName)}>{name}</p>
        {detail ? <p {...stylex.props(styles.brandDetail)}>{detail}</p> : null}
      </div>
    </div>
  );
}

export function WorkspaceNavigation({
  label,
  children,
  showLabel = true,
}: {
  label: string;
  children: ReactNode;
  showLabel?: boolean;
}) {
  return (
    <nav aria-label={label} {...stylex.props(styles.navGroup)}>
      {showLabel ? <p {...stylex.props(styles.navigationLabel)}>{label}</p> : null}
      <div {...stylex.props(styles.navigation)}>{children}</div>
    </nav>
  );
}

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

export function WorkspaceHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header {...stylex.props(styles.header)}>
      <h1 {...stylex.props(styles.title)}>{title}</h1>
      {action}
    </header>
  );
}

export function WorkspaceNavLink({
  active = false,
  current = active,
  ...props
}: ComponentProps<typeof Link> & { active?: boolean; current?: boolean }) {
  return (
    <Link
      {...props}
      aria-current={current ? "page" : undefined}
      {...stylex.props(styles.navItem, styles.navLink, active && styles.navActive)}
    />
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

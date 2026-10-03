import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Circle, CircleAlert, CircleCheck, CircleDashed, CircleDot } from "lucide-react";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { Link } from "@open-erp/ui/components/link";

const styles = stylex.create({
  workspace: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 400px",
    minHeight: "100dvh",
    marginInline: tokens.spaceNegative5,
    marginBlockStart: tokens.spaceNegative4,
    marginBlockEnd: tokens.spaceNegative8,
    "@container (max-width: 60rem)": { gridTemplateColumns: "minmax(0, 1fr)" },
    "@media (max-width: 767px)": { marginInline: tokens.spaceNegative4 },
  },
  main: { minWidth: 0 },
  fullWidth: { gridTemplateColumns: "minmax(0, 1fr)" },
  header: {
    display: "flex",
    flexWrap: "wrap",
    paddingBlock: tokens.space1_5,
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space4,
    minHeight: 48,
    paddingInline: tokens.space5,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  heading: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    gap: tokens.space4_5,
    flexWrap: "wrap",
  },
  title: {
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight18Px,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space2,
    minHeight: 40,
    paddingInline: tokens.space5,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  group: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space2,
    height: 30,
    paddingInline: tokens.space5,
    backgroundColor: tokens.sidebar,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.mutedForeground,
  },
  row: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    minHeight: 40,
    paddingInline: tokens.space5,
    paddingBlock: tokens.space2,
    borderWidth: 0,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    backgroundColor: { default: tokens.transparent, ":hover": tokens.sidebar },
    color: tokens.foreground,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    textAlign: "start",
    cursor: "pointer",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRingInset },
  },
  selected: {
    backgroundColor: { default: tokens.registerSelected, ":hover": tokens.registerSelected },
  },
  symbol: {
    display: "flex",
    alignItems: "center",
    width: 22,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  pending: { color: tokens.primary },
  warning: { color: tokens.registerWarning },
  completed: { color: tokens.registerSuccess },
  rowTitle: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  prefix: { color: tokens.mutedForeground, marginInlineEnd: tokens.space3, flexShrink: 0 },
  rowState: {
    width: 150,
    flexShrink: 0,
    color: tokens.mutedForeground,
    paddingInlineStart: tokens.space3,
    "@container (max-width: 40rem)": { display: "none" },
  },
  amount: { width: 100, flexShrink: 0, textAlign: "end", fontVariantNumeric: "tabular-nums" },
  detail: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.space4,
    minWidth: 0,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.border,
    paddingBlock: tokens.space5,
    paddingInline: tokens.space6,
    "@container (max-width: 60rem)": {
      borderInlineStartWidth: 0,
      borderBlockStartWidth: 1,
      borderBlockStartStyle: "solid",
      borderBlockStartColor: tokens.border,
    },
  },
  detailTitle: {
    fontSize: tokens.fontSizeLg,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightTitle,
  },
  detailAmount: {
    fontSize: tokens.fontSize3xl,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: tokens.trackingSerif,
    fontVariantNumeric: "tabular-nums",
    lineHeight: tokens.lineHeightTitle,
  },
  caption: {
    fontSize: tokens.fontSizeXs,
    color: tokens.mutedForeground,
    lineHeight: tokens.lineHeight16Px,
  },
  actions: { display: "grid", gap: tokens.space2, marginBlockStart: "auto" },
  tabs: { display: "flex", flexWrap: "wrap", gap: tokens.space4 },
  tab: {
    borderWidth: 0,
    backgroundColor: tokens.transparent,
    color: tokens.mutedForeground,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    padding: tokens.space0,
    minHeight: 28,
    cursor: "pointer",
    textDecoration: "none",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  activeTab: { color: tokens.foreground, fontWeight: tokens.fontWeightSemibold },
});

export type RegisterStatus = "open" | "pending" | "warning" | "completed" | "draft";

export function RegisterWorkspace({
  title,
  tabs,
  action,
  filters,
  children,
  detail,
}: {
  title: string;
  tabs?: ReactNode;
  action?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.workspace, detail === undefined && styles.fullWidth)}>
      <section {...stylex.props(styles.main)}>
        <header {...stylex.props(styles.header)}>
          <div {...stylex.props(styles.heading)}>
            <h1 {...stylex.props(styles.title)}>{title}</h1>
            {tabs}
          </div>
          {action}
        </header>
        {filters ? <div {...stylex.props(styles.toolbar)}>{filters}</div> : null}
        {children}
      </section>
      {detail !== undefined ? <aside {...stylex.props(styles.detail)}>{detail}</aside> : null}
    </div>
  );
}

export function RegisterGroup({ title, count }: { title: string; count?: number }) {
  return (
    <h2 {...stylex.props(styles.group)}>
      {title}
      {count !== undefined ? <span>{count}</span> : null}
    </h2>
  );
}

export function RegisterRow({
  id,
  prefix,
  title,
  status,
  state,
  amount,
  selected,
  onSelect,
}: {
  id?: string;
  prefix?: string;
  title: string;
  status: RegisterStatus;
  state: string;
  amount: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const icons = {
    completed: CircleCheck,
    warning: CircleAlert,
    draft: CircleDashed,
    pending: CircleDot,
    open: Circle,
  };

  const Icon = icons[status];

  return (
    <button
      type="button"
      data-sales-id={id}
      aria-pressed={selected}
      onClick={onSelect}
      {...stylex.props(styles.row, selected && styles.selected)}
    >
      <span
        {...stylex.props(
          styles.symbol,
          status === "pending" && styles.pending,
          status === "warning" && styles.warning,
          status === "completed" && styles.completed,
        )}
      >
        <Icon size={14} strokeWidth={1.4} aria-hidden="true" />
      </span>
      {prefix ? <span {...stylex.props(styles.prefix)}>{prefix}</span> : null}
      <span {...stylex.props(styles.rowTitle)}>{title}</span>
      <span {...stylex.props(styles.rowState, status === "warning" && styles.warning)}>
        {state}
      </span>
      <span {...stylex.props(styles.amount)}>{amount}</span>
    </button>
  );
}

export function RegisterNavigation({
  label,
  options,
}: {
  label: string;
  options: readonly { label: string; href: string; active: boolean; preload?: () => void }[];
}) {
  return (
    <nav aria-label={label} {...stylex.props(styles.tabs)}>
      {options.map((option) => (
        <Link
          key={option.href}
          href={option.href}
          aria-current={option.active ? "page" : undefined}
          onPointerEnter={option.preload}
          onFocus={option.preload}
          {...stylex.props(styles.tab, option.active && styles.activeTab)}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}

export function RegisterDetailHeading({
  title,
  amount,
  caption,
}: {
  title: string;
  amount: string;
  caption: string;
}) {
  return (
    <div>
      <p {...stylex.props(styles.caption)}>{caption}</p>
      <h2 {...stylex.props(styles.detailTitle)}>{title}</h2>
      <p {...stylex.props(styles.detailAmount)}>{amount}</p>
    </div>
  );
}

export function RegisterDetailActions({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.actions)}>{children}</div>;
}

export function RegisterTabs({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} {...stylex.props(styles.tabs)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          {...stylex.props(styles.tab, value === option.value && styles.activeTab)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

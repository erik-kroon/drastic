import type { ComponentProps, ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Circle, CircleCheck } from "lucide-react";
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
  wide: {
    gridTemplateColumns: "minmax(0, 1fr) 420px",
    "@container (max-width: 60rem)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  invoice: {
    gridTemplateColumns: "minmax(0, 1fr) 340px",
    "@container (max-width: 60rem)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  fullWidth: { gridTemplateColumns: "minmax(0, 1fr)" },
  header: {
    display: "flex",
    flexWrap: "wrap",
    paddingBlockStart: tokens.space0,
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
    gap: tokens.space4,
    flexWrap: "wrap",
  },
  workHeading: { gap: tokens.space4_5 },
  workTabs: { gap: tokens.space4 },
  title: {
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight20Px,
    marginBlockEnd: 1,
  },
  action: { display: "flex", marginBlockEnd: 1 },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 40,
    paddingInline: tokens.space5,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  filters: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  toolbarSummary: {
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    fontVariantNumeric: "tabular-nums",
  },
  chip: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    height: 26,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.input,
    borderRadius: tokens.radiusControl,
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    boxSizing: "border-box",
    backgroundColor: { default: tokens.transparent, ":hover": tokens.sidebar },
    ":focus-within": { outline: "none", boxShadow: tokens.focusRing },
  },
  chipSelect: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    opacity: 0,
    cursor: "pointer",
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
  groupCount: { fontWeight: tokens.fontWeightMedium, color: tokens.captionForeground },
  row: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    minHeight: 40,
    paddingInline: tokens.space5,
    paddingBlockStart: tokens.space2,
    paddingBlockEnd: 9,
    "@media (pointer: coarse)": { minHeight: 44 },
    borderWidth: 0,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
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
    boxShadow: tokens.selectionIndicator,
    borderBlockEndColor: tokens.border,
  },
  selectedTitle: { fontWeight: tokens.fontWeightMedium },
  symbol: {
    display: "flex",
    alignItems: "center",
    width: 22,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  pending: { color: tokens.primary },
  warning: { color: tokens.registerWarning },
  overdue: { color: tokens.destructive },
  draftSymbol: { color: tokens.registerDraft },
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
    "@container (max-width: 40rem)": { display: "none" },
  },
  amount: { width: 100, flexShrink: 0, textAlign: "end", fontVariantNumeric: "tabular-nums" },
  compactState: { width: 130, paddingInlineStart: 0 },
  detail: {
    display: "flex",
    flexDirection: "column",
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
  checkRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 40,
    paddingBlock: tokens.space1,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  checkIcon: { width: 14, flexShrink: 0, color: tokens.warningForeground },
  checkComplete: { color: tokens.successForeground },
  checkTitle: { flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" },
  checkAction: { flexShrink: 0 },
  detailTitle: {
    fontSize: tokens.fontSizeLg,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight22Px,
    marginBlock: 2,
  },
  detailNote: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    marginBlockStart: 2,
  },
  detailLink: {
    color: { default: tokens.primary, ":hover": tokens.primary },
    textDecoration: { default: "none", ":hover": "underline" },
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  detailLinks: {
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.space3,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  detailAmount: {
    fontSize: tokens.fontSizeBankBalance,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: tokens.trackingSerif,
    fontVariantNumeric: "tabular-nums",
    lineHeight: tokens.lineHeightBankBalance,
  },
  caption: {
    fontSize: tokens.fontSizeXs,
    color: tokens.captionForeground,
    lineHeight: tokens.lineHeight16Px,
  },
  actions: { display: "grid", gap: 10, marginBlockStart: "auto", paddingBlockStart: tokens.space4 },
  lines: { marginBlockStart: 20 },
  reviewLines: { marginBlockStart: tokens.space2 },
  lineList: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
  },
  linesTitle: {
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.captionForeground,
    textTransform: "uppercase",
    lineHeight: tokens.lineHeight16Px,
    marginBlockEnd: tokens.space1_5,
  },
  line: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space3,
    minHeight: 32,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  lineDescription: { minWidth: 0, overflowWrap: "anywhere" },
  reviewLine: { minHeight: tokens.controlHeightLg },
  lineAmount: { flexShrink: 0, fontVariantNumeric: "tabular-nums", textAlign: "end" },
  tabs: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, minWidth: 0 },
  tab: {
    display: "flex",
    alignItems: "flex-start",
    borderWidth: 0,
    backgroundColor: tokens.transparent,
    color: tokens.mutedForeground,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeControl,
    fontWeight: tokens.fontWeightMedium,
    lineHeight: tokens.lineHeight16Px,
    paddingInline: tokens.space0,
    paddingBlockStart: 15,
    paddingBlockEnd: 14,
    minHeight: 47,
    boxSizing: "border-box",
    cursor: "pointer",
    textDecoration: "none",
    position: "relative",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  activeTab: {
    color: tokens.foreground,
    paddingBlockStart: 14.5,
    "::after": {
      content: "''",
      position: "absolute",
      insetInline: 0,
      insetBlockEnd: 0,
      height: 2,
      backgroundColor: tokens.primary,
    },
  },
});

export type RegisterStatus = "open" | "pending" | "warning" | "overdue" | "completed" | "draft";

// Status marks from the Paper register component: 14 px, 1.4 stroke, shape carries the meaning.
function StatusMark({ status }: { status: RegisterStatus }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.4 };

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      {status === "completed" ? (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M4.3 7.2l1.9 1.9 3.5-3.7" fill="none" stroke="#fff" strokeWidth="1.4" />
        </>
      ) : status === "draft" ? (
        <circle cx="7" cy="7" r="5.5" {...common} strokeDasharray="2.5 2.5" />
      ) : status === "overdue" || status === "warning" ? (
        <>
          <circle cx="7" cy="7" r="5.5" {...common} />
          <path d="M7 4v3.4M7 9.4v.2" {...common} strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="7" cy="7" r="5.5" {...common} />
          {status === "pending" ? <path d="M7 3.5a3.5 3.5 0 010 7z" fill="currentColor" /> : null}
        </>
      )}
    </svg>
  );
}

export function RegisterDetailLines({
  title,
  lines,
  rowSize = "standard",
}: {
  title: string;
  lines: readonly { id: string; description: string; amount: string }[];
  rowSize?: "standard" | "review";
}) {
  return (
    <section
      {...stylex.props(styles.lines, rowSize === "review" && styles.reviewLines)}
      aria-label={title}
    >
      <h2 {...stylex.props(styles.linesTitle)}>{title}</h2>
      <dl {...stylex.props(styles.lineList)}>
        {lines.map((line) => (
          <div
            key={line.id}
            {...stylex.props(styles.line, rowSize === "review" && styles.reviewLine)}
          >
            <dt {...stylex.props(styles.lineDescription)}>{line.description}</dt>
            <dd {...stylex.props(styles.lineAmount)}>{line.amount}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function RegisterWorkspace({
  title,
  tabs,
  action,
  filters,
  summary,
  children,
  detail,
  detailSize = "standard",
  headingSpacing = "standard",
}: {
  title: string;
  tabs?: ReactNode;
  action?: ReactNode;
  filters?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  detail?: ReactNode;
  detailSize?: "standard" | "wide" | "invoice";
  headingSpacing?: "standard" | "work";
}) {
  return (
    <div
      {...stylex.props(
        styles.workspace,
        detailSize === "wide" && styles.wide,
        detailSize === "invoice" && styles.invoice,
        detail === undefined && styles.fullWidth,
      )}
    >
      <section {...stylex.props(styles.main)}>
        <header {...stylex.props(styles.header)}>
          <div {...stylex.props(styles.heading, headingSpacing === "work" && styles.workHeading)}>
            <h1 {...stylex.props(styles.title)}>{title}</h1>
            {tabs}
          </div>
          {action ? <div {...stylex.props(styles.action)}>{action}</div> : null}
        </header>
        {filters || summary ? (
          <div {...stylex.props(styles.toolbar)}>
            <div {...stylex.props(styles.filters)}>{filters}</div>
            {summary ? <span {...stylex.props(styles.toolbarSummary)}>{summary}</span> : null}
          </div>
        ) : null}
        {children}
      </section>
      {detail !== undefined ? <aside {...stylex.props(styles.detail)}>{detail}</aside> : null}
    </div>
  );
}

export function RegisterFilter({
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
  const selected = options.find((option) => option.value === value);

  return (
    <label {...stylex.props(styles.chip)}>
      {selected && selected.value !== options[0]?.value ? `${label}: ${selected.label}` : label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        {...stylex.props(styles.chipSelect)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RegisterGroup({ title, count }: { title: string; count?: number }) {
  return (
    <h2 {...stylex.props(styles.group)}>
      {title}
      {count !== undefined ? <span {...stylex.props(styles.groupCount)}>{count}</span> : null}
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
  stateSize = "standard",
}: {
  id?: string;
  prefix?: string;
  title: string;
  status: RegisterStatus;
  state: string;
  amount: string;
  selected: boolean;
  onSelect: () => void;
  stateSize?: "standard" | "compact";
}) {
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
          status === "overdue" && styles.overdue,
          status === "draft" && styles.draftSymbol,
          status === "completed" && styles.completed,
        )}
      >
        <StatusMark status={status} />
      </span>
      {prefix ? <span {...stylex.props(styles.prefix)}>{prefix}</span> : null}
      <span {...stylex.props(styles.rowTitle, selected && styles.selectedTitle)}>{title}</span>
      <span
        {...stylex.props(
          styles.rowState,
          stateSize === "compact" && styles.compactState,
          status === "warning" && styles.warning,
          status === "overdue" && styles.overdue,
        )}
      >
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
  note,
}: {
  title: string;
  amount?: string;
  caption: string;
  note?: string;
}) {
  return (
    <div>
      <p {...stylex.props(styles.caption)}>{caption}</p>
      <h2 {...stylex.props(styles.detailTitle)}>{title}</h2>
      {amount !== undefined ? <p {...stylex.props(styles.detailAmount)}>{amount}</p> : null}
      {note ? <p {...stylex.props(styles.detailNote)}>{note}</p> : null}
    </div>
  );
}

export function RegisterDetailLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} {...stylex.props(styles.detailLink)} />;
}

export function RegisterDetailLinks({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.detailLinks)}>{children}</div>;
}

export function RegisterDetailActions({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.actions)}>{children}</div>;
}

export function RegisterTabs({
  label,
  value,
  options,
  onChange,
  spacing = "standard",
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  spacing?: "standard" | "work";
}) {
  return (
    <div
      role="group"
      aria-label={label}
      {...stylex.props(styles.tabs, spacing === "work" && styles.workTabs)}
    >
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

export function RegisterCheckRow(props: { title: string; completed: boolean; action?: ReactNode }) {
  return (
    <div {...stylex.props(styles.checkRow)}>
      <span {...stylex.props(styles.checkIcon, props.completed && styles.checkComplete)}>
        {props.completed ? (
          <CircleCheck size={14} aria-hidden="true" />
        ) : (
          <Circle size={14} aria-hidden="true" />
        )}
      </span>
      <span {...stylex.props(styles.checkTitle)}>{props.title}</span>
      <span {...stylex.props(styles.checkAction)}>{props.action}</span>
    </div>
  );
}

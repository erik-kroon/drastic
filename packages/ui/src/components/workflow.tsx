import { useState, type ComponentProps, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Check, ChevronRight } from "lucide-react";
import { Link } from "@open-erp/ui/components/link";
import { Button } from "@open-erp/ui/components/button";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  review: {
    display: "grid",
    alignItems: "stretch",
    minWidth: 0,
    gap: 0,
    gridTemplateColumns: {
      default: "minmax(0, 1fr) 420px",
      "@container (max-width: 50rem)": "minmax(0, 1fr)",
    },
  },
  reviewEvidence: {
    display: "grid",
    gap: tokens.space4,
    backgroundColor: tokens.reviewCanvas,
    paddingBlock: tokens.space6,
    paddingInline: { default: tokens.space8, "@container (max-width: 50rem)": tokens.space4 },
    minWidth: 0,
  },
  reviewDecision: {
    display: "flex",
    flexDirection: "column",
    minHeight: "calc(100dvh - 48px)",
    gap: tokens.space4,
    paddingBlock: tokens.space5,
    paddingInline: tokens.space6,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.border,
    minWidth: 0,
  },
  focusedReview: {
    minHeight: "calc(100dvh - 48px)",
    "@media (max-width: 1023px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  focusedEvidence: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.space2,
    paddingBlock: tokens.space3,
  },
  focusedOriginal: { width: 620, maxWidth: "100%", minWidth: 0 },
  focusedDecision: { gap: 0 },
  paneSwitch: {
    display: "none",
    "@media (max-width: 1023px)": {
      display: "flex",
      gap: tokens.space2,
      padding: tokens.space3,
    },
  },
  inactivePane: { "@media (max-width: 1023px)": { display: "none" } },
  layout: {
    display: "grid",
    gap: tokens.space8,
    alignItems: "start",
    minWidth: 0,
    gridTemplateColumns: {
      default: "minmax(0, 1fr) 17rem",
      "@container (max-width: 62rem)": "minmax(0, 1fr)",
    },
  },
  main: { minWidth: 0 },
  aside: { display: "grid", gap: tokens.space6, paddingBlock: tokens.space2, minWidth: 0 },
  surface: {
    backgroundColor: tokens.card,
    borderRadius: tokens.radiusSurface,
    boxShadow: tokens.shadowRaised,
    minWidth: 0,
    overflow: "clip",
  },
  section: {
    display: "grid",
    gap: tokens.space5,
    padding: { default: tokens.space6, "@media (max-width: 599px)": tokens.space4 },
    minWidth: 0,
  },
  steps: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.space4,
    alignItems: "center",
    paddingBlock: tokens.space4,
    marginBlockEnd: tokens.space2,
  },
  step: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space2,
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeSm,
  },
  current: { color: tokens.foreground, fontWeight: tokens.fontWeightSemibold },
  number: {
    display: "grid",
    placeItems: "center",
    width: tokens.space6,
    height: tokens.space6,
    flexShrink: 0,
    borderRadius: tokens.radiusFull,
    backgroundColor: tokens.secondary,
    fontSize: tokens.fontSizeXs,
    fontVariantNumeric: "tabular-nums",
  },
  currentNumber: { backgroundColor: tokens.foreground, color: tokens.background },
  done: { backgroundColor: tokens.success, color: tokens.successForeground },
  tabs: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.space1,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.space2,
    paddingBlock: tokens.space3,
    paddingInline: tokens.space4,
    minHeight: tokens.space11,
    fontSize: tokens.fontSizeSm,
    color: { default: tokens.mutedForeground, ":hover": tokens.foreground },
    textDecoration: "none",
    borderBlockEndWidth: 2,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: "transparent",
    marginBlockEnd: -1,
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  activeTab: {
    color: tokens.foreground,
    borderBlockEndColor: tokens.foreground,
    fontWeight: tokens.fontWeightSemibold,
  },
  disclosure: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
    paddingBlock: tokens.space4,
    fontSize: tokens.fontSizeSm,
    color: tokens.mutedForeground,
  },
  summary: {
    cursor: "pointer",
    minHeight: tokens.space10,
    alignContent: "center",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
    "::marker": { color: tokens.mutedForeground },
  },
  details: { paddingBlockStart: tokens.space4, color: tokens.foreground },
  compactDisclosure: {
    paddingBlock: 0,
    borderBlockStartWidth: 0,
    fontSize: tokens.fontSizeControl,
  },
  compactSummary: { minHeight: tokens.controlHeightSm },
  focusedDisclosure: {
    paddingBlock: 0,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  note: {
    display: "grid",
    gap: tokens.space2,
    borderInlineStartWidth: 2,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.border,
    paddingInlineStart: tokens.space4,
  },
  entryRow: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(12rem, 1.5fr) minmax(8rem, 1fr) minmax(8rem, 1fr)",
      "@container (max-width: 44rem)": "minmax(0, 1fr)",
    },
    gap: tokens.space3,
    minWidth: 0,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
    paddingBlock: tokens.space4,
  },
  rowDetail: {
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "end",
    flexWrap: "wrap",
    gap: tokens.space3,
    minWidth: 0,
  },
  totals: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: tokens.space4,
    backgroundColor: tokens.secondary,
    borderRadius: tokens.radiusControl,
    padding: tokens.space4,
    fontVariantNumeric: "tabular-nums",
  },
});

export function WorkflowLayout({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div {...stylex.props(styles.layout)}>
      <div {...stylex.props(styles.main)}>{children}</div>
      <aside {...stylex.props(styles.aside)}>{aside}</aside>
    </div>
  );
}

export function WorkflowSurface({ children }: { children: ReactNode }) {
  return (
    <section {...stylex.props(styles.surface)}>
      <div {...stylex.props(styles.section)}>{children}</div>
    </section>
  );
}

export function ReviewColumns({
  evidence,
  children,
  focused,
}: {
  evidence: ReactNode;
  children: ReactNode;
  focused?: { evidenceLabel: string; decisionLabel: string };
}) {
  const [pane, setPane] = useState<"evidence" | "decision">("evidence");

  return (
    <>
      {focused ? (
        <div {...stylex.props(styles.paneSwitch)}>
          <Button
            variant={pane === "evidence" ? "default" : "outline"}
            aria-pressed={pane === "evidence"}
            onClick={() => setPane("evidence")}
          >
            {focused.evidenceLabel}
          </Button>
          <Button
            variant={pane === "decision" ? "default" : "outline"}
            aria-pressed={pane === "decision"}
            onClick={() => setPane("decision")}
          >
            {focused.decisionLabel}
          </Button>
        </div>
      ) : null}
      <div {...stylex.props(styles.review, focused && styles.focusedReview)}>
        <section
          aria-label={focused?.evidenceLabel}
          {...stylex.props(
            styles.reviewEvidence,
            focused && styles.focusedEvidence,
            focused && pane !== "evidence" && styles.inactivePane,
          )}
        >
          {focused ? <div {...stylex.props(styles.focusedOriginal)}>{evidence}</div> : evidence}
        </section>
        <section
          aria-label={focused?.decisionLabel}
          {...stylex.props(
            styles.reviewDecision,
            focused && styles.focusedDecision,
            focused && pane !== "decision" && styles.inactivePane,
          )}
        >
          {children}
        </section>
      </div>
    </>
  );
}

export function WorkflowSteps({
  labels,
  current,
  label,
}: {
  labels: readonly string[];
  current: number;
  label: string;
}) {
  return (
    <ol aria-label={label} {...stylex.props(styles.steps)}>
      {labels.map((text, index) => (
        <li
          key={text}
          aria-current={index === current ? "step" : undefined}
          {...stylex.props(styles.step, index === current && styles.current)}
        >
          <span
            {...stylex.props(
              styles.number,
              index === current && styles.currentNumber,
              index < current && styles.done,
            )}
          >
            {index < current ? <Check size={14} aria-hidden="true" /> : index + 1}
          </span>
          {text}
          {index < labels.length - 1 ? <ChevronRight size={14} aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  );
}

export function PageTabs({ children, label }: { children: ReactNode; label: string }) {
  return (
    <nav aria-label={label} {...stylex.props(styles.tabs)}>
      {children}
    </nav>
  );
}

export function PageTab({ active, ...props }: ComponentProps<typeof Link> & { active: boolean }) {
  return (
    <Link
      {...props}
      aria-current={active ? "page" : undefined}
      {...stylex.props(styles.tab, active && styles.activeTab)}
    />
  );
}

export function Disclosure({
  title,
  children,
  defaultOpen = false,
  compact = false,
  presentation,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  compact?: boolean;
  presentation?: "focused";
}) {
  return (
    <details
      open={defaultOpen}
      {...stylex.props(
        styles.disclosure,
        compact && styles.compactDisclosure,
        presentation === "focused" && styles.focusedDisclosure,
      )}
    >
      <summary
        role="button"
        {...stylex.props(
          styles.summary,
          (compact || presentation === "focused") && styles.compactSummary,
        )}
      >
        {title}
      </summary>
      <div {...stylex.props(styles.details)}>{children}</div>
    </details>
  );
}

export function WorkflowNote({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.note)}>{children}</div>;
}

export function EntryRow({
  label,
  children,
  detail,
}: {
  label: string;
  children: ReactNode;
  detail: ReactNode;
}) {
  return (
    <fieldset aria-label={label} {...stylex.props(styles.entryRow)}>
      {children}
      <div {...stylex.props(styles.rowDetail)}>{detail}</div>
    </fieldset>
  );
}

export function EntryTotals({ children }: { children: ReactNode }) {
  return (
    <div role="status" {...stylex.props(styles.totals)}>
      {children}
    </div>
  );
}

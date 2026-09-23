import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  heading: { display: "flex", alignItems: "start", justifyContent: "space-between", gap: 24 },
  title: {
    fontFamily: tokens.fontSerif,
    fontSize: tokens.fontSize2xl,
    fontWeight: tokens.fontWeightNormal,
    lineHeight: tokens.lineHeight32Px,
  },
  subtitle: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeControl,
    marginBlockStart: 6,
  },
  summary: {
    display: "flex",
    flexWrap: "wrap",
    gap: 32,
    paddingBlock: 20,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  fact: { display: "grid", gap: 6, minWidth: 130 },
  label: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight20Px,
  },
  value: {
    fontSize: tokens.fontSizeLg,
    fontWeight: tokens.fontWeightMedium,
    fontVariantNumeric: "tabular-nums",
    overflowWrap: "anywhere",
  },
  split: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 300px",
    gap: 32,
    alignItems: "start",
    "@container (max-width: 50rem)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  columns: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 32,
    alignItems: "start",
    "@container (max-width: 50rem)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  paper: {
    display: "grid",
    gap: 28,
    padding: 32,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.card,
    minWidth: 0,
  },
  section: { display: "grid", gap: 16, minWidth: 0 },
  sectionTitle: {
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightMedium,
    paddingBlockEnd: 12,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
});
export function RecordHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.heading)}>
      <div>
        <h2 {...stylex.props(styles.title)}>{title}</h2>
        {subtitle ? <p {...stylex.props(styles.subtitle)}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
export function RecordSummary({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.summary)}>{children}</div>;
}
export function RecordFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.fact)}>
      <span {...stylex.props(styles.label)}>{label}</span>
      <span {...stylex.props(styles.value)}>{children}</span>
    </div>
  );
}
export function RecordSplit({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div {...stylex.props(styles.split)}>
      <div {...stylex.props(styles.section)}>{children}</div>
      <aside {...stylex.props(styles.section)}>{aside}</aside>
    </div>
  );
}
export function DocumentPaper({ children }: { children: ReactNode }) {
  return <article {...stylex.props(styles.paper)}>{children}</article>;
}
export function RecordSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section {...stylex.props(styles.section)}>
      <h3 {...stylex.props(styles.sectionTitle)}>{title}</h3>
      {children}
    </section>
  );
}

export function RecordColumns({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.columns)}>{children}</div>;
}

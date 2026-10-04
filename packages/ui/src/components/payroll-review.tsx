import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { RegisterWorkspace } from "@open-erp/ui/components/register-workspace";

const styles = stylex.create({
  breadcrumb: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space4_5,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  notice: {
    paddingBlock: tokens.space2_5,
    paddingInline: tokens.space5,
    backgroundColor: tokens.sidebar,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.mutedForeground,
  },
  footnote: {
    paddingBlock: tokens.space3,
    paddingInline: tokens.space5,
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
  },
  complete: { color: tokens.successForeground },
});

export function PayrollReviewLayout(props: {
  title: string;
  breadcrumb: ReactNode;
  stateLabel: ReactNode;
  notice: string;
  action?: ReactNode;
  amounts: ReactNode;
  footnote: string;
  children: ReactNode;
}) {
  return (
    <RegisterWorkspace
      title={props.title}
      action={props.action}
      tabs={
        <div {...stylex.props(styles.breadcrumb)}>
          {props.breadcrumb}
          <span>{props.stateLabel}</span>
        </div>
      }
    >
      <div {...stylex.props(styles.notice)}>{props.notice}</div>
      {props.amounts}
      <div {...stylex.props(styles.footnote)}>{props.footnote}</div>
      {props.children}
    </RegisterWorkspace>
  );
}

export function PayrollInputStatus({ children }: { children: ReactNode }) {
  return <span {...stylex.props(styles.complete)}>{children}</span>;
}

const payslipStyles = stylex.create({
  canvas: {
    minHeight: "calc(100dvh - 48px)",
    backgroundColor: tokens.background,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingInline: tokens.space4,
  },
  card: {
    width: "min(520px, 100%)",
    marginBlockStart: tokens.space12,
    padding: tokens.space7,
    backgroundColor: tokens.card,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusSurface,
  },
  title: {
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight20Px,
  },
  subtitle: {
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.mutedForeground,
    marginBlockStart: 2,
    marginBlockEnd: 18,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.space4,
    minHeight: 34,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    fontVariantNumeric: "tabular-nums",
  },
  total: {
    minHeight: 36,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    fontSize: tokens.fontSizeControl,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight18Px,
  },
  note: {
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.captionForeground,
    marginBlockStart: 14,
  },
});

export function PayrollPayslipCard(props: {
  title: string;
  subtitle: string;
  rows: readonly { id: string; label: string; amount: string; total?: boolean }[];
  note: string;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(payslipStyles.canvas)}>
      <section {...stylex.props(payslipStyles.card)}>
        <h2 {...stylex.props(payslipStyles.title)}>{props.title}</h2>
        <p {...stylex.props(payslipStyles.subtitle)}>{props.subtitle}</p>
        {props.rows.map((row) => (
          <div key={row.id} {...stylex.props(payslipStyles.row, row.total && payslipStyles.total)}>
            <span>{row.label}</span>
            <span>{row.amount}</span>
          </div>
        ))}
        <p {...stylex.props(payslipStyles.note)}>{props.note}</p>
        {props.children}
      </section>
    </div>
  );
}

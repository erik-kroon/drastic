import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { supplierApprovalExpiryTokens } from "@open-erp/ui/theme/supplier-approval-expiry.stylex";
import { Button } from "@open-erp/ui/components/button";

const styles = stylex.create({
  pane: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    paddingBlockStart: tokens.space1,
    paddingBlockEnd: tokens.space1,
  },
  caption: {
    color: supplierApprovalExpiryTokens.captionForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
  },
  title: {
    color: tokens.foreground,
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight22Px,
    marginBlockStart: tokens.space0_5,
  },
  amount: {
    color: tokens.foreground,
    fontSize: tokens.fontSize2xl,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight30Px,
  },
  warning: {
    backgroundColor: supplierApprovalExpiryTokens.warningBackground,
    borderColor: supplierApprovalExpiryTokens.warningBorder,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: tokens.radiusControl,
    marginBlockStart: tokens.space3_5,
    paddingBlock: tokens.space2_5,
    paddingInline: tokens.space3,
    color: tokens.warningForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight18Px,
  },
  label: {
    color: supplierApprovalExpiryTokens.captionForeground,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight16Px,
    marginBlockStart: tokens.space5,
    marginBlockEnd: tokens.space1_5,
  },
  row: {
    display: "flex",
    alignItems: "center",
    minHeight: 32,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.reviewCanvas,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.foreground,
  },
  first: { borderBlockStartColor: tokens.border },
  last: {
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.reviewCanvas,
  },
  rowLabel: { display: "flex", flexGrow: 1 },
  current: { display: "flex", color: tokens.registerSuccess },
  expired: { display: "flex", color: tokens.destructive },
  explanation: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight18Px,
    marginBlockStart: tokens.space2_5,
  },
  actions: {
    marginBlockStart: "auto",
    paddingBlockStart: tokens.space5,
    display: "grid",
    gap: tokens.space2,
  },
  button: { width: "100%", height: 32, minHeight: 32 },
  disabled: { color: supplierApprovalExpiryTokens.captionForeground },
});

export function SupplierApprovalExpiryPane(props: {
  heading?: { caption: string; title: string; amount: string };
  approvalLabel: string;
  notice: string;
  proposalLabel: string;
  unchangedLabel: string;
  actorLabel: string;
  approvedAt: string;
  expiryLabel: string;
  expiredAt: string;
  explanation: string;
  postLabel: string;
  renewal: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section {...stylex.props(styles.pane)} aria-label={props.approvalLabel}>
      {props.heading ? (
        <>
          <p {...stylex.props(styles.caption)}>{props.heading.caption}</p>
          <h2 {...stylex.props(styles.title)}>{props.heading.title}</h2>
          <p {...stylex.props(styles.amount)}>{props.heading.amount}</p>
        </>
      ) : null}
      <p role="status" {...stylex.props(styles.warning)}>
        {props.notice}
      </p>
      <h3 {...stylex.props(styles.label)}>{props.approvalLabel.toLocaleUpperCase()}</h3>
      <div {...stylex.props(styles.row, styles.first)}>
        <span {...stylex.props(styles.rowLabel)}>{props.proposalLabel}</span>
        <span {...stylex.props(styles.current)}>{props.unchangedLabel}</span>
      </div>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.rowLabel)}>{props.actorLabel}</span>
        <span {...stylex.props(styles.current)}>{props.approvedAt}</span>
      </div>
      <div {...stylex.props(styles.row, styles.last)}>
        <span {...stylex.props(styles.rowLabel)}>{props.expiryLabel}</span>
        <span {...stylex.props(styles.expired)}>{props.expiredAt}</span>
      </div>
      <p {...stylex.props(styles.explanation)}>{props.explanation}</p>
      {props.children}
      <div {...stylex.props(styles.actions)}>
        {props.renewal}
        <Button disabled static fullWidth styleX={[styles.button, styles.disabled]}>
          {props.postLabel}
        </Button>
      </div>
    </section>
  );
}

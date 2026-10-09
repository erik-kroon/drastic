import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  layout: { maxWidth: 720, paddingInline: tokens.space2, paddingBlockStart: tokens.space2 },
  caption: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
  },
  amount: {
    fontSize: tokens.fontSize4xl,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight44Px,
    letterSpacing: tokens.trackingAmount,
    fontVariantNumeric: "tabular-nums",
    marginBlockStart: 2,
    marginBlockEnd: 18,
  },
  notice: {
    marginBlockStart: tokens.space4,
    marginBlockEnd: tokens.space6,
    paddingBlock: tokens.space2_5,
    paddingInline: tokens.space3,
    backgroundColor: tokens.registerSelected,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusLg,
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 36,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  rows: {
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
});

export function VatOverview({
  caption,
  amount,
  notice,
  rows,
  children,
}: {
  caption: string;
  amount: string;
  notice: string;
  rows: readonly { label: string; amount: string }[];
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(styles.layout)}>
      <p {...stylex.props(styles.caption)}>{caption}</p>
      <p {...stylex.props(styles.amount)}>{amount}</p>
      <dl {...stylex.props(styles.rows)}>
        {rows.map((row) => (
          <div key={row.label} {...stylex.props(styles.row)}>
            <dt>{row.label}</dt>
            <dd>{row.amount}</dd>
          </div>
        ))}
      </dl>
      <p {...stylex.props(styles.notice)}>{notice}</p>
      {children}
    </section>
  );
}

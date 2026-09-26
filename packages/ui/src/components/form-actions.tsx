import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  row: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  sticky: {
    position: "sticky",
    bottom: 0,
    zIndex: 2,
    paddingBlock: 16,
    backgroundColor: tokens.card,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
  },
});

export function FormActions({
  children,
  sticky = false,
}: {
  children: ReactNode;
  sticky?: boolean;
}) {
  return <div {...stylex.props(styles.row, sticky && styles.sticky)}>{children}</div>;
}

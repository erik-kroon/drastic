import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.7fr) minmax(0, 1fr)",
    gap: 48,
    paddingBlock: 28,
    paddingInline: 12,
    "@container (max-width: 60rem)": { gridTemplateColumns: "minmax(0, 1fr)", gap: 28 },
    "@media (max-width: 767px)": { paddingInline: 0 },
  },
  column: { display: "grid", alignContent: "start", gap: 30, minWidth: 0 },
  context: { color: tokens.mutedForeground, fontSize: tokens.fontSizeControl },
});

export function OverviewLayout(props: { context: string; main: ReactNode; aside: ReactNode }) {
  return (
    <div {...stylex.props(styles.layout)}>
      <div {...stylex.props(styles.column)}>
        <p {...stylex.props(styles.context)}>{props.context}</p>
        {props.main}
      </div>
      <div {...stylex.props(styles.column)}>{props.aside}</div>
    </div>
  );
}

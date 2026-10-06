import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  root: { display: "grid", gap: tokens.space6, minWidth: 0 },
  heading: {
    display: "flex",
    alignItems: "center",
    minHeight: 48,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight20Px,
  },
  task: { display: "grid", gap: tokens.space3, minWidth: 0 },
  title: {
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight22Px,
    overflowWrap: "anywhere",
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.space4,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight20Px,
  },
  caption: {
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight20Px,
  },
});

export function QuestionTaskContext(props: {
  heading: string;
  kind: string;
  title: string;
  state: string;
  date: string;
  amount: string;
  assignee: string;
  questions: string;
}) {
  return (
    <section {...stylex.props(styles.root)}>
      <h2 {...stylex.props(styles.heading)}>{props.heading}</h2>
      <div {...stylex.props(styles.task)}>
        <p {...stylex.props(styles.caption)}>{props.kind}</p>
        <h3 {...stylex.props(styles.title)}>{props.title}</h3>
        <div {...stylex.props(styles.row)}>
          <span>{props.state}</span>
          <span {...stylex.props(styles.caption)}>{props.date}</span>
          <span>{props.amount}</span>
        </div>
        <div {...stylex.props(styles.row)}>
          <span>{props.assignee}</span>
          <span>{props.questions}</span>
        </div>
      </div>
    </section>
  );
}

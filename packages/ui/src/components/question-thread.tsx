import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { FileText } from "lucide-react";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  thread: { display: "grid", gap: tokens.space4, minWidth: 0 },
  heading: { display: "grid", gap: tokens.space2 },
  title: {
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight22Px,
    overflowWrap: "anywhere",
  },
  status: {
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  answered: { color: tokens.registerSuccess },
  message: { display: "grid", gap: tokens.space1, minWidth: 0 },
  actor: {
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    overflowWrap: "anywhere",
  },
  text: {
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight20Px,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  reply: {
    marginBlockStart: tokens.space0_5,
    paddingBlock: tokens.space2,
    paddingInline: tokens.space3,
    backgroundColor: tokens.sidebar,
    borderRadius: tokens.radiusControl,
  },
  attachment: { minWidth: 0 },
  attachmentRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.space2,
    minHeight: tokens.controlHeightLg,
    paddingInline: tokens.space2_5,
    paddingBlock: tokens.space1,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusControl,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    listStyle: "none",
  },
  attachmentTrigger: {
    cursor: "pointer",
    color: tokens.primary,
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  filename: { flex: "1", minWidth: 0, overflowWrap: "anywhere" },
  attachmentStatus: { color: tokens.captionForeground, overflowWrap: "anywhere" },
  preview: { marginBlockStart: tokens.space2, minWidth: 0 },
});

export function QuestionThread({
  title,
  status,
  state,
  children,
}: {
  title: string;
  status: string;
  state: "open" | "answered" | "closed";
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(styles.thread)}>
      <div {...stylex.props(styles.heading)}>
        <p {...stylex.props(styles.status, state !== "open" && styles.answered)}>{status}</p>
        <h3 {...stylex.props(styles.title)}>{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function QuestionMessage({
  actor,
  createdAt,
  time,
  text,
  reply,
  children,
}: {
  actor: string;
  createdAt: string;
  time: string;
  text: string;
  reply: boolean;
  children?: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.message)}>
      <p {...stylex.props(styles.actor)}>
        {actor} <time dateTime={createdAt}>{time}</time>
      </p>
      <p {...stylex.props(styles.text, reply && styles.reply)}>{text}</p>
      {children}
    </div>
  );
}

export function QuestionAttachment({
  filename,
  status,
  children,
}: {
  filename: string;
  status: string;
  children?: ReactNode;
}) {
  const row = (
    <>
      <FileText size={14} aria-hidden="true" />
      <span {...stylex.props(styles.filename)}>{filename}</span>
      <span {...stylex.props(styles.attachmentStatus)}>{status}</span>
    </>
  );

  return children ? (
    <details {...stylex.props(styles.attachment)}>
      <summary {...stylex.props(styles.attachmentRow, styles.attachmentTrigger)}>{row}</summary>
      <div {...stylex.props(styles.preview)}>{children}</div>
    </details>
  ) : (
    <div {...stylex.props(styles.attachmentRow)}>{row}</div>
  );
}

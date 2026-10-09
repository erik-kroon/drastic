import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { kanon } from "@open-erp/ui/theme/kanon.stylex";

/** The eight statuses on board K-04. Every list row, panel header and toast uses one. */
export type Status =
  | "proposal"
  | "needsYou"
  | "replied"
  | "unread"
  | "watching"
  | "overdue"
  | "unknown"
  | "done";

const styles = stylex.create({
  icon: { display: "block", flexShrink: 0, height: kanon.sizeIcon, width: kanon.sizeIcon },
  label: {
    alignItems: "center",
    display: "inline-flex",
    fontFamily: kanon.fontUi,
    fontSize: kanon.textBody,
    gap: kanon.space2,
    lineHeight: kanon.leadingBody,
  },
  proposal: { color: kanon.colorAction },
  needsYou: { color: kanon.colorWarning },
  replied: { color: kanon.colorAction },
  unread: { color: kanon.colorMuted },
  watching: { color: kanon.colorCaption },
  overdue: { color: kanon.colorError },
  unknown: { color: kanon.colorWarning },
  done: { color: kanon.colorSuccess },
  neutralText: { color: kanon.colorSecondary },
});

const tone = {
  proposal: styles.proposal,
  needsYou: styles.needsYou,
  replied: styles.replied,
  unread: styles.unread,
  watching: styles.watching,
  overdue: styles.overdue,
  unknown: styles.unknown,
  done: styles.done,
} as const;

/** Statuses whose state text stays neutral grey; the icon alone carries the colour. */
const neutralText = new Set<Status>(["proposal", "unread", "watching"]);

function Glyph({ status }: { status: Status }) {
  switch (status) {
    case "proposal":
      return (
        <>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7 3.5a3.5 3.5 0 010 7z" fill="currentColor" />
        </>
      );
    case "needsYou":
      return (
        <>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M7 4v3.4M7 9.4v.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
      );
    case "replied":
      return (
        <>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M5 7h4M7.5 5.2L9.3 7 7.5 8.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "unread":
      return (
        <circle
          cx="7"
          cy="7"
          r="5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeDasharray="2.4 2"
        />
      );
    case "watching":
    case "overdue":
      return (
        <>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M7 4.2V7l1.8 1.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "unknown":
      return (
        <>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M5.6 5.6a1.4 1.4 0 112 1.3c-.4.2-.6.5-.6.9M7 9.6v.1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </>
      );
    case "done":
      return (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path
            d="M4.4 7.2l1.9 1.9 3.3-3.6"
            fill="none"
            stroke="white"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
  }
}

/** Decorative by default: the adjacent state text names the status for screen readers. */
export function StatusIcon({ status }: { status: Status }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" {...stylex.props(styles.icon, tone[status])}>
      <Glyph status={status} />
    </svg>
  );
}

/** Icon plus state text in the status colour, for panels, tables and check rows. */
export function StatusLabel({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span {...stylex.props(styles.label, tone[status])}>
      <StatusIcon status={status} />
      <span {...stylex.props(neutralText.has(status) && styles.neutralText)}>{children}</span>
    </span>
  );
}

/** Text colour for a status shown without its icon, such as a list row's state column. */
export function statusTextStyle(status: Status) {
  return neutralText.has(status) ? styles.neutralText : tone[status];
}

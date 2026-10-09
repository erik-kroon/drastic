import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { kanon } from "@open-erp/ui/theme/kanon.stylex";

const styles = stylex.create({
  file: {
    alignItems: "center",
    backgroundColor: kanon.colorSideSurface,
    borderColor: kanon.colorRule,
    borderRadius: kanon.radiusCard,
    borderStyle: "solid",
    borderWidth: 1,
    display: "flex",
    fontFamily: kanon.fontUi,
    gap: kanon.space3,
    paddingBlock: kanon.space2,
    paddingInline: kanon.space3,
  },
  sheet: {
    alignItems: "center",
    backgroundColor: kanon.colorSurface,
    borderColor: kanon.colorControl,
    borderRadius: kanon.radiusSheet,
    borderStyle: "solid",
    borderWidth: 1,
    color: kanon.colorCaption,
    display: "flex",
    flexShrink: 0,
    height: kanon.sizeSheetHeight,
    justifyContent: "center",
    width: kanon.sizeSheetWidth,
  },
  fileText: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    gap: kanon.spaceHair,
    minWidth: 0,
  },
  fileName: {
    color: kanon.colorText,
    fontSize: kanon.textBody,
    fontWeight: kanon.weightMedium,
    lineHeight: kanon.leadingBody,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  caption: {
    color: kanon.colorCaption,
    fontSize: kanon.textCaption,
    lineHeight: kanon.leadingBody,
  },
  activity: {
    display: "flex",
    flexDirection: "column",
    gap: kanon.space3,
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  event: { alignItems: "center", display: "flex", fontFamily: kanon.fontUi, gap: kanon.space3 },
  avatar: {
    alignItems: "center",
    borderRadius: kanon.radiusPill,
    color: kanon.colorAction,
    display: "flex",
    flexShrink: 0,
    fontSize: kanon.textMicro,
    fontWeight: kanon.weightBold,
    height: kanon.sizeAvatar,
    justifyContent: "center",
    width: kanon.sizeAvatar,
  },
  person: { backgroundColor: kanon.colorAvatar },
  agent: { backgroundColor: kanon.colorSelectedRow },
  client: { backgroundColor: kanon.colorAvatarClient, color: kanon.colorSuccess },
  eventText: {
    color: kanon.colorText,
    flexGrow: 1,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
  },
});

/** The retained original, as a row with a page glyph. `action` is usually an "Öppna" InlineAction. */
export function EvidenceFile({
  name,
  detail,
  action,
}: {
  name: string;
  detail: string;
  action: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.file)}>
      <span aria-hidden="true" {...stylex.props(styles.sheet)}>
        <svg width="14" height="14" viewBox="0 0 16 16">
          <path
            d="M4 2h6l3 3v9H4zM10 2v3h3M6 9h4M6 11.5h4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span {...stylex.props(styles.fileText)}>
        <span {...stylex.props(styles.fileName)}>{name}</span>
        <span {...stylex.props(styles.caption)}>{detail}</span>
      </span>
      {action}
    </div>
  );
}

export type ActivityEvent = {
  id: string;
  /** Two letters for a person, "A" for the agent. */
  initials: string;
  actor: "person" | "agent" | "client";
  text: string;
  /** Preformatted, such as "2 okt 09:13". */
  time: string;
};

/** Newest first. The agent is always shown as its own actor, never as the person it worked for. */
export function ActivityList({ events }: { events: ReadonlyArray<ActivityEvent> }) {
  return (
    <ol {...stylex.props(styles.activity)}>
      {events.map((event) => (
        <li key={event.id} {...stylex.props(styles.event)}>
          <span aria-hidden="true" {...stylex.props(styles.avatar, styles[event.actor])}>
            {event.initials}
          </span>
          <span {...stylex.props(styles.eventText)}>{event.text}</span>
          <span {...stylex.props(styles.caption)}>{event.time}</span>
        </li>
      ))}
    </ol>
  );
}

import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { StatusIcon, statusTextStyle } from "@open-erp/ui/kanon/status";
import { kanon } from "@open-erp/ui/theme/kanon.stylex";

const styles = stylex.create({
  check: {
    alignItems: "flex-start",
    display: "flex",
    fontFamily: kanon.fontUi,
    fontSize: kanon.textBody,
    gap: kanon.space2,
    lineHeight: kanon.leadingSection,
    margin: 0,
  },
  checkIcon: { display: "flex", flexShrink: 0, paddingTop: kanon.space05 },
  banner: {
    borderRadius: kanon.radiusCard,
    borderStyle: "solid",
    borderWidth: 1,
    display: "flex",
    fontFamily: kanon.fontUi,
    gap: kanon.space3,
    paddingBlock: kanon.space3,
    paddingInline: kanon.space4,
  },
  unknown: {
    backgroundColor: kanon.colorUnknownBackground,
    borderColor: kanon.colorUnknownBorder,
    color: kanon.colorUnknownText,
  },
  blocked: {
    backgroundColor: kanon.colorBlockedBackground,
    borderColor: kanon.colorBlockedBorder,
    color: kanon.colorBlockedText,
  },
  bannerIcon: { display: "flex", flexShrink: 0, paddingTop: kanon.spaceHair },
  bannerText: { display: "flex", flexDirection: "column", gap: kanon.space1 },
  bannerTitle: {
    fontSize: kanon.textBody,
    fontWeight: kanon.weightSemibold,
    lineHeight: kanon.leadingBody,
    margin: 0,
  },
  bannerBody: { fontSize: kanon.textBody, lineHeight: kanon.leadingSection, margin: 0 },
});

/**
 * One confirmed or doubtful fact, as an icon and a sentence. Use it under the card it checks.
 * done: confirmed. needsYou: doubtful, does not block. overdue: wrong.
 */
export function CheckRow({
  result,
  children,
}: {
  result: "done" | "needsYou" | "overdue";
  children: ReactNode;
}) {
  return (
    <p {...stylex.props(styles.check, statusTextStyle(result))}>
      <span {...stylex.props(styles.checkIcon)}>
        <StatusIcon status={result} />
      </span>
      {children}
    </p>
  );
}

/**
 * Only when something blocks the decision. The title names the state, the body says what to do.
 * unknown: an outcome is missing ("Okänt utfall"). blocked: an earlier approval no longer holds.
 */
export function Banner({
  kind,
  title,
  children,
}: {
  kind: "unknown" | "blocked";
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      {...stylex.props(styles.banner, kind === "unknown" ? styles.unknown : styles.blocked)}
    >
      <span {...stylex.props(styles.bannerIcon)}>
        <StatusIcon status={kind === "unknown" ? "unknown" : "overdue"} />
      </span>
      <div {...stylex.props(styles.bannerText)}>
        <p {...stylex.props(styles.bannerTitle)}>{title}</p>
        <p {...stylex.props(styles.bannerBody)}>{children}</p>
      </div>
    </div>
  );
}

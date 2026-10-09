import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { StatusIcon, statusTextStyle, type Status } from "@open-erp/ui/kanon/status";
import { kanon } from "@open-erp/ui/theme/kanon.stylex";

const styles = stylex.create({
  panel: {
    backgroundColor: kanon.colorSurface,
    borderInlineStartColor: kanon.colorRule,
    borderInlineStartStyle: "solid",
    borderInlineStartWidth: 1,
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    gap: kanon.space5,
    minHeight: 0,
    overflowY: "auto",
    padding: kanon.space7,
    width: kanon.sizePanel,
  },
  header: { display: "flex", flexDirection: "column", gap: kanon.space1 },
  kicker: {
    alignItems: "center",
    color: kanon.colorCaption,
    display: "flex",
    fontFamily: kanon.fontUi,
    fontSize: kanon.textCaption,
    gap: kanon.space2,
    lineHeight: kanon.leadingBody,
  },
  kickerStatus: { fontWeight: kanon.weightSemibold },
  figure: {
    color: kanon.colorText,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textFigure,
    fontVariantNumeric: "tabular-nums",
    fontWeight: kanon.weightSemibold,
    letterSpacing: kanon.trackingFigure,
    lineHeight: kanon.leadingFigure,
    margin: 0,
  },
  subtitle: {
    color: kanon.colorSecondary,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingSection,
    margin: 0,
  },
  section: { display: "flex", flexDirection: "column", gap: kanon.space2 },
  sectionHead: { alignItems: "baseline", display: "flex", justifyContent: "space-between" },
  label: {
    color: kanon.colorSecondary,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textCaption,
    fontWeight: kanon.weightSemibold,
    lineHeight: kanon.leadingBody,
    margin: 0,
  },
  spacer: { flexGrow: 1 },
  actions: { display: "flex", flexDirection: "column", gap: kanon.space2 },
  note: {
    color: kanon.colorCaption,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textCaption,
    lineHeight: kanon.leadingBody,
    margin: 0,
  },
  secondaryRow: {
    display: "grid",
    gap: kanon.space2,
    gridAutoColumns: "minmax(0, 1fr)",
    gridAutoFlow: "column",
  },
});

type Kicker = string | { status: Status; text: string };

type DetailPanelProps = {
  /** Caption above the figure: the record type, or a status such as "Bokförd som A153". */
  kicker: Kicker;
  /** The amount, preformatted. Use a short word instead when there is no amount ("3 klara"). */
  figure: string;
  /** One line: counterparty and reference. "Nordhamn Studio AB, faktura 1048." */
  subtitle: string;
  /** PanelSection elements, in the K-06 order: evidence, what will happen, checks, activity. */
  children: ReactNode;
  /** Exactly one primary Action. */
  primary: ReactNode;
  /** Up to three secondary or quiet Actions, shown in one row under the primary. */
  secondary?: ReactNode;
  /** One line above the buttons when the step has two parts: "Förberedelsen bokför inget." */
  note?: string;
  label: string;
};

export function DetailPanel(props: DetailPanelProps) {
  const { kicker, secondary, note } = props;

  return (
    <aside aria-label={props.label} {...stylex.props(styles.panel)}>
      <header {...stylex.props(styles.header)}>
        {typeof kicker === "string" ? (
          <span {...stylex.props(styles.kicker)}>{kicker}</span>
        ) : (
          <span
            {...stylex.props(styles.kicker, styles.kickerStatus, statusTextStyle(kicker.status))}
          >
            <StatusIcon status={kicker.status} />
            {kicker.text}
          </span>
        )}
        <p {...stylex.props(styles.figure)}>{props.figure}</p>
        <p {...stylex.props(styles.subtitle)}>{props.subtitle}</p>
      </header>
      {props.children}
      <div {...stylex.props(styles.spacer)} />
      <div {...stylex.props(styles.actions)}>
        {note !== undefined && <p {...stylex.props(styles.note)}>{note}</p>}
        {props.primary}
        {secondary !== undefined && <div {...stylex.props(styles.secondaryRow)}>{secondary}</div>}
      </div>
    </aside>
  );
}

/** A labelled block inside the panel or a focus page. `action` is a quiet link on the right. */
export function PanelSection({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionHead)}>
        <h3 {...stylex.props(styles.label)}>{label}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

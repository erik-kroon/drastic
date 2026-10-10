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
    minWidth: 0,
    overflowY: "auto",
    padding: kanon.space7,
    width: kanon.sizePanel,
    "@container (max-width: 60rem)": {
      width: "100%",
      borderInlineStartWidth: 0,
      borderBlockStartWidth: 1,
      borderBlockStartStyle: "solid",
      borderBlockStartColor: kanon.colorRule,
      overflowY: "visible",
    },
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
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  },
  subtitle: {
    color: kanon.colorSecondary,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingSection,
    fontWeight: kanon.weightRegular,
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
  tertiary?: ReactNode;
  label: string;
};

export function DetailPanelSurface({
  label,
  children,
  as: Surface = "aside",
}: {
  label: string;
  children: ReactNode;
  as?: "aside" | "section";
}) {
  return (
    <Surface aria-label={label} {...stylex.props(styles.panel)}>
      {children}
    </Surface>
  );
}

export function DetailPanelHeader(
  props: Pick<DetailPanelProps, "kicker" | "figure" | "subtitle"> & {
    subtitleAs?: "p" | "h2";
    figureAs?: "p" | "h2";
  },
) {
  const { kicker, figure, subtitle } = props;
  const Subtitle = props.subtitleAs ?? "p";
  const Figure = props.figureAs ?? "p";

  return (
    <header {...stylex.props(styles.header)}>
      {typeof kicker === "string" ? (
        <span {...stylex.props(styles.kicker)}>{kicker}</span>
      ) : (
        <span {...stylex.props(styles.kicker, styles.kickerStatus, statusTextStyle(kicker.status))}>
          <StatusIcon status={kicker.status} />
          {kicker.text}
        </span>
      )}
      <Figure {...stylex.props(styles.figure)}>{figure}</Figure>
      <Subtitle {...stylex.props(styles.subtitle)}>{subtitle}</Subtitle>
    </header>
  );
}

export function DetailPanelActions({
  primary,
  secondary,
  note,
  tertiary,
}: Pick<DetailPanelProps, "primary" | "secondary" | "note" | "tertiary">) {
  return (
    <>
      <div {...stylex.props(styles.spacer)} />
      <div {...stylex.props(styles.actions)}>
        {note !== undefined && <p {...stylex.props(styles.note)}>{note}</p>}
        {primary}
        {secondary !== undefined && <div {...stylex.props(styles.secondaryRow)}>{secondary}</div>}
        {tertiary}
      </div>
    </>
  );
}

export function DetailPanel(props: DetailPanelProps) {
  return (
    <DetailPanelSurface label={props.label}>
      <DetailPanelHeader kicker={props.kicker} figure={props.figure} subtitle={props.subtitle} />
      {props.children}
      <DetailPanelActions primary={props.primary} secondary={props.secondary} note={props.note} />
    </DetailPanelSurface>
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

import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { StatusIcon, statusTextStyle, type Status } from "@open-erp/ui/kanon/status";
import { kanon } from "@open-erp/ui/theme/kanon.stylex";

const styles = stylex.create({
  list: {
    backgroundColor: kanon.colorSurface,
    display: "flex",
    flexDirection: "column",
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  group: { display: "contents" },
  controls: {
    alignItems: "center",
    borderBottomColor: kanon.colorRule,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    minHeight: kanon.sizeRow,
    justifyContent: "space-between",
    gap: kanon.space2,
    paddingInline: kanon.space8,
  },
  sort: {
    color: kanon.colorSecondary,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textCaption,
    lineHeight: kanon.leadingBody,
  },
  carded: {
    borderColor: kanon.colorRule,
    borderRadius: kanon.radiusCard,
    borderStyle: "solid",
    borderWidth: 1,
    overflow: "hidden",
    width: "100%",
  },
  groupHeader: {
    alignItems: "flex-end",
    borderBottomColor: kanon.colorRule,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    gap: kanon.space2,
    height: kanon.sizeGroupHeader,
    paddingBottom: kanon.space2,
    paddingInline: kanon.space8,
  },
  laterGroupHeader: { height: kanon.sizeRowTall },
  groupTitle: {
    color: kanon.colorText,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textCaption,
    fontWeight: kanon.weightSemibold,
    lineHeight: kanon.leadingBody,
    margin: 0,
  },
  pill: {
    backgroundColor: kanon.colorRule,
    borderRadius: kanon.radiusPill,
    color: kanon.colorSecondary,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textCaption,
    fontVariantNumeric: "tabular-nums",
    fontWeight: kanon.weightMedium,
    lineHeight: kanon.leadingBody,
    paddingInline: kanon.space2,
  },
  row: {
    alignItems: "center",
    backgroundColor: { default: kanon.colorSurface, ":hover": kanon.colorSideSurface },
    borderBottomColor: kanon.colorRule,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    borderBlockStartWidth: 0,
    borderInlineEndWidth: 0,
    borderInlineStartColor: "transparent",
    borderInlineStartStyle: "solid",
    borderInlineStartWidth: kanon.sizeSelectedEdge,
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    fontFamily: kanon.fontUi,
    minHeight: kanon.sizeRow,
    paddingInlineEnd: kanon.space8,
    paddingInlineStart: `calc(${kanon.space8} - ${kanon.sizeSelectedEdge})`,
    textAlign: "start",
    textDecoration: "none",
    width: "100%",
    ":focus-visible": { outline: "none", boxShadow: kanon.shadowFocus },
  },
  rowTall: { minHeight: kanon.sizeRowTall },
  selected: {
    backgroundColor: kanon.colorSelectedRow,
    borderInlineStartColor: kanon.colorAction,
  },
  statusColumn: { display: "flex", flexShrink: 0, width: kanon.sizeStatusColumn },
  titleColumn: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    gap: kanon.space1,
    minWidth: 0,
  },
  title: {
    color: kanon.colorText,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  detail: { color: kanon.colorCaption, fontSize: kanon.textCaption, lineHeight: kanon.leadingBody },
  reference: {
    color: kanon.colorSecondary,
    flexShrink: 0,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
    width: kanon.sizeLabelColumn,
  },
  state: {
    flexShrink: 0,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
    paddingInlineStart: kanon.space4,
    width: kanon.sizeStateColumn,
    "@container (max-width: 40rem)": { display: "none" },
  },
  amount: {
    color: kanon.colorText,
    flexShrink: 0,
    fontSize: kanon.textBody,
    fontVariantNumeric: "tabular-nums",
    lineHeight: kanon.leadingBody,
    textAlign: "end",
    width: kanon.sizeAmountColumn,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    paddingBlock: kanon.space1,
  },
});

/**
 * A grouped work list. With a detail panel beside it, the list runs edge to edge (the default).
 * Without one, pass `carded`: the card sits inside the page gutter, or the 1000 px FocusPage column.
 */
export function WorkList({ children, carded = false }: { children: ReactNode; carded?: boolean }) {
  return <ul {...stylex.props(styles.list, carded && styles.carded)}>{children}</ul>;
}

export function WorkListControls({
  filterAction,
  sortLabel,
}: {
  filterAction: ReactNode;
  sortLabel: string;
}) {
  return (
    <div {...stylex.props(styles.controls)}>
      {filterAction}
      <span {...stylex.props(styles.sort)}>{sortLabel}</span>
    </div>
  );
}

export function CountPill({ count }: { count: number | string }) {
  return <span {...stylex.props(styles.pill)}>{count}</span>;
}

/** A group header with its count. Pass `first` for the topmost group, which sits closer. */
export function WorkGroup({
  title,
  count,
  first = false,
  children,
}: {
  title: string;
  count: number;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <li {...stylex.props(styles.group)}>
      <div {...stylex.props(styles.groupHeader, !first && styles.laterGroupHeader)}>
        <h2 {...stylex.props(styles.groupTitle)}>{title}</h2>
        <CountPill count={count} />
      </div>
      <ul {...stylex.props(styles.list)}>{children}</ul>
    </li>
  );
}

type WorkRowProps = {
  status: Status;
  title: string;
  /** Second line in caption text, such as "Godkänd av Elin Sund 2 okt 09:13". Makes the row 52 px. */
  detail?: string;
  /** Short identifier before the title, such as an invoice or voucher number. */
  reference?: string;
  /** The state column, coloured by status: "Förfallen 19 dagar". */
  state?: string;
  /** Preformatted with formatMinorAmount. */
  amount?: string;
  selected?: boolean;
  autoFocus?: boolean;
  onSelect: () => void;
};

export function WorkRow(props: WorkRowProps) {
  const { status, detail, reference, selected } = props;

  return (
    <li {...stylex.props(styles.group)}>
      <button
        type="button"
        aria-current={selected === true ? "true" : undefined}
        aria-pressed={selected === true}
        autoFocus={props.autoFocus}
        onClick={props.onSelect}
        {...stylex.props(
          styles.row,
          detail !== undefined && styles.rowTall,
          selected === true && styles.selected,
        )}
      >
        <span {...stylex.props(styles.statusColumn)}>
          <StatusIcon status={status} />
        </span>
        {reference !== undefined && <span {...stylex.props(styles.reference)}>{reference}</span>}
        <span {...stylex.props(styles.titleColumn)}>
          <span {...stylex.props(styles.title)}>{props.title}</span>
          {detail !== undefined && <span {...stylex.props(styles.detail)}>{detail}</span>}
        </span>
        <span {...stylex.props(styles.state, statusTextStyle(status))}>{props.state}</span>
        <span {...stylex.props(styles.amount)}>{props.amount}</span>
      </button>
    </li>
  );
}

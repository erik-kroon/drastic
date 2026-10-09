import { Button as ButtonPrimitive } from "@base-ui/react/button";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps, ReactNode } from "react";

import { StatusIcon, statusTextStyle, type Status } from "@open-erp/ui/kanon/status";
import { CountPill } from "@open-erp/ui/kanon/work-list";
import { kanon } from "@open-erp/ui/theme/kanon.stylex";

type Render = ComponentProps<typeof ButtonPrimitive>["render"];

const styles = stylex.create({
  page: {
    backgroundColor: kanon.colorSurface,
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    height: "100%",
    minHeight: 0,
  },
  bar: {
    alignItems: "center",
    backgroundColor: kanon.colorSurface,
    borderBottomColor: kanon.colorRule,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    flexShrink: 0,
    fontFamily: kanon.fontUi,
    gap: kanon.space6,
    height: kanon.sizeBar,
    paddingInline: kanon.space8,
  },
  barTitle: {
    color: kanon.colorText,
    fontSize: kanon.textPage,
    fontWeight: kanon.weightSemibold,
    lineHeight: kanon.leadingPage,
    margin: 0,
  },
  tabs: { alignSelf: "stretch", display: "flex", gap: kanon.space5 },
  tab: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderBottomColor: "transparent",
    borderBottomStyle: "solid",
    borderBottomWidth: 2,
    borderWidth: 0,
    color: { default: kanon.colorSecondary, ":hover": kanon.colorText },
    cursor: "pointer",
    display: "flex",
    fontFamily: kanon.fontUi,
    fontSize: kanon.textBody,
    gap: kanon.space2,
    lineHeight: kanon.leadingBody,
    paddingInline: 0,
    textDecoration: "none",
  },
  tabActive: {
    borderBottomColor: kanon.colorAction,
    color: kanon.colorText,
    fontWeight: kanon.weightMedium,
  },
  barEnd: { alignItems: "center", display: "flex", gap: kanon.space2, marginInlineStart: "auto" },
  crumbs: {
    alignItems: "center",
    display: "flex",
    gap: kanon.space2,
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  crumb: {
    color: kanon.colorSecondary,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
    textDecoration: "none",
  },
  crumbSeparator: { color: kanon.colorCaption, fontSize: kanon.textBody },
  crumbCurrent: {
    color: kanon.colorText,
    fontSize: kanon.textBody,
    fontWeight: kanon.weightSemibold,
  },
  body: { display: "flex", flexGrow: 1, minHeight: 0 },
  scroll: { flexGrow: 1, minWidth: 0, overflowY: "auto" },
  focus: {
    display: "flex",
    flexDirection: "column",
    gap: kanon.space6,
    marginInline: "auto",
    maxWidth: kanon.sizeFocused,
    paddingBlock: kanon.space8,
    paddingInline: kanon.space8,
    width: "100%",
  },
  queue: {
    backgroundColor: kanon.colorSideSurface,
    borderInlineEndColor: kanon.colorRule,
    borderInlineEndStyle: "solid",
    borderInlineEndWidth: 1,
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    gap: kanon.space05,
    overflowY: "auto",
    padding: kanon.space2,
    width: kanon.sizeQueue,
  },
  queueHead: { alignItems: "center", display: "flex", gap: kanon.space2, padding: kanon.space2 },
  queueTitle: {
    color: kanon.colorText,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textBody,
    fontWeight: kanon.weightSemibold,
  },
  queueItem: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: kanon.radiusControl,
    borderWidth: 0,
    cursor: "pointer",
    display: "flex",
    fontFamily: kanon.fontUi,
    gap: kanon.space3,
    paddingBlock: kanon.space2,
    paddingInline: kanon.space3,
    textAlign: "start",
    width: "100%",
  },
  queueItemSelected: { backgroundColor: kanon.colorSurface, boxShadow: kanon.shadowSelected },
  queueText: { display: "flex", flexDirection: "column", gap: kanon.spaceHair, minWidth: 0 },
  queueName: { color: kanon.colorText, fontSize: kanon.textBody, lineHeight: kanon.leadingBody },
  queueMeta: { fontSize: kanon.textCaption, lineHeight: kanon.leadingBody },
  viewer: {
    backgroundColor: kanon.colorViewer,
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    gap: kanon.space2,
    minWidth: 0,
    overflowY: "auto",
    paddingBlock: kanon.space3,
    paddingInline: kanon.space6,
  },
  paper: {
    backgroundColor: kanon.colorSurface,
    borderColor: kanon.colorControl,
    borderRadius: kanon.radiusControl,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: kanon.shadowDocument,
    overflow: "hidden",
  },
});

/** Top bar inside an area: title, tabs with counts, one action at the end. */
export function AreaBar({
  title,
  tabs,
  action,
}: {
  title: string;
  tabs?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header {...stylex.props(styles.bar)}>
      <h1 {...stylex.props(styles.barTitle)}>{title}</h1>
      {tabs !== undefined && <nav {...stylex.props(styles.tabs)}>{tabs}</nav>}
      {action !== undefined && <div {...stylex.props(styles.barEnd)}>{action}</div>}
    </header>
  );
}

export function BarTab({
  label,
  count,
  active,
  render,
}: {
  label: string;
  count?: number;
  active: boolean;
  render: Render;
}) {
  return (
    <ButtonPrimitive
      render={render}
      nativeButton={false}
      aria-current={active ? "page" : undefined}
      {...stylex.props(styles.tab, active && styles.tabActive)}
    >
      {label}
      {count !== undefined && <CountPill count={count} />}
    </ButtonPrimitive>
  );
}

export type Crumb = { label: string; render: Render };

/** Top bar inside a record: breadcrumbs ending in the current record, optional pager at the end. */
export function DetailBar({
  crumbs,
  current,
  pager,
}: {
  crumbs: ReadonlyArray<Crumb>;
  current: string;
  pager?: ReactNode;
}) {
  return (
    <header {...stylex.props(styles.bar)}>
      <ol {...stylex.props(styles.crumbs)}>
        {crumbs.map((crumb) => (
          <li key={crumb.label} {...stylex.props(styles.crumbs)}>
            <ButtonPrimitive
              render={crumb.render}
              nativeButton={false}
              {...stylex.props(styles.crumb)}
            >
              {crumb.label}
            </ButtonPrimitive>
            <span aria-hidden="true" {...stylex.props(styles.crumbSeparator)}>
              /
            </span>
          </li>
        ))}
        <li aria-current="page" {...stylex.props(styles.crumbCurrent)}>
          {current}
        </li>
      </ol>
      {pager !== undefined && <div {...stylex.props(styles.barEnd)}>{pager}</div>}
    </header>
  );
}

/** Layout A: a list that runs edge to edge, with the detail panel on the right. */
export function ListDetailPage({
  bar,
  list,
  panel,
}: {
  bar: ReactNode;
  list: ReactNode;
  panel: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.page)}>
      {bar}
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.scroll)}>{list}</div>
        {panel}
      </div>
    </div>
  );
}

/** Layout B: queue, the original in the middle, the decision panel on the right. */
export function ReviewPage({
  bar,
  queue,
  original,
  panel,
}: {
  bar: ReactNode;
  queue: ReactNode;
  original: ReactNode;
  panel: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.page)}>
      {bar}
      <div {...stylex.props(styles.body)}>
        {queue}
        {original}
        {panel}
      </div>
    </div>
  );
}

/** Layout C: one column, at most 1000 px, for forms, drafts, overviews and settings. */
export function FocusPage({ bar, children }: { bar: ReactNode; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.page)}>
      {bar}
      <div {...stylex.props(styles.scroll)}>
        <div {...stylex.props(styles.focus)}>{children}</div>
      </div>
    </div>
  );
}

/** The left column of layout B. */
export function ReviewQueue({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <nav aria-label={title} {...stylex.props(styles.queue)}>
      <div {...stylex.props(styles.queueHead)}>
        <span {...stylex.props(styles.queueTitle)}>{title}</span>
        <CountPill count={count} />
      </div>
      {children}
    </nav>
  );
}

export function QueueItem(props: {
  status: Status;
  name: string;
  /** Second line: the amount, or the reason it is waiting ("Typ saknas"). */
  meta: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={props.selected ? "true" : undefined}
      onClick={props.onSelect}
      {...stylex.props(styles.queueItem, props.selected && styles.queueItemSelected)}
    >
      <StatusIcon status={props.status} />
      <span {...stylex.props(styles.queueText)}>
        <span {...stylex.props(styles.queueName)}>{props.name}</span>
        <span {...stylex.props(styles.queueMeta, statusTextStyle(props.status))}>{props.meta}</span>
      </span>
    </button>
  );
}

/** The grey canvas in layout B. `toolbar` holds page and zoom controls; children is the document. */
export function OriginalViewer({
  toolbar,
  children,
}: {
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(styles.viewer)}>
      {toolbar}
      <div {...stylex.props(styles.paper)}>{children}</div>
    </section>
  );
}

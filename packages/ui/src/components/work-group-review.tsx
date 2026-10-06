import type { ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { CheckboxControl } from "./selection-controls";
import { Link } from "./link";
import { Button } from "./button";

const styles = stylex.create({
  popup: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.card,
    color: tokens.foreground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    fontSynthesis: "none",
    whiteSpace: "pre-wrap",
    overflow: "hidden",
  },
  resultCheck: { display: "inline-block" },
  top: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space2,
    height: 48,
    flexShrink: 0,
    paddingInline: 20,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  title: {
    margin: 0,
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight20Px,
  },
  context: {
    marginInlineStart: "auto",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.captionForeground,
  },
  breadcrumb: {
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.mutedForeground,
  },
  body: { display: "flex", flexGrow: 1, minHeight: 0 },
  list: { flexGrow: 1, minWidth: 0, overflowY: "auto" },
  detail: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
    width: 420,
    flexShrink: 0,
    paddingBlock: 20,
    paddingInline: 24,
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: tokens.border,
    overflowY: "auto",
  },
  section: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space2,
    height: 30,
    paddingInline: 20,
    backgroundColor: tokens.sidebar,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.mutedForeground,
  },
  row: {
    display: "flex",
    alignItems: "center",
    minHeight: 52,
    paddingInline: 20,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rowDivider,
  },
  changed: { minHeight: 64, backgroundColor: tokens.warning },
  rowCaption: {
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightNormal,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.mutedForeground,
  },
  changedCaption: { color: tokens.warningForeground },
  checkbox: { width: 30, flexShrink: 0 },
  qualifier: {
    marginInlineStart: "auto",
    fontWeight: tokens.fontWeightNormal,
    color: tokens.mutedForeground,
  },
  listNote: {
    paddingBlock: 12,
    paddingInline: 20,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.captionForeground,
  },
  rowLink: { color: "inherit", textDecoration: "none" },
  cancel: { height: 28, justifyContent: "flex-start", paddingInline: 0 },
  post: {
    height: tokens.controlHeight,
    fontWeight: tokens.fontWeightMedium,
    borderWidth: 0,
    backgroundClip: "border-box",
    paddingBlock: 0,
  },
  titleLane: {
    flexGrow: 1,
    minWidth: 0,
    fontSize: tokens.fontSizeControl,
    fontWeight: tokens.fontWeightMedium,
    lineHeight: tokens.lineHeight16Px,
  },
  individualTitle: { fontWeight: tokens.fontWeightNormal },
  sectionCount: { color: tokens.captionForeground, fontWeight: tokens.fontWeightMedium },
  resultBanner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: 44,
    paddingInline: 20,
    backgroundColor: tokens.registerSuccessBackground,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.successBorder,
    color: tokens.registerSuccess,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  excludedResult: { minHeight: 40 },
  resultIcon: { color: tokens.registerSuccess },
  resultControls: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 28,
  },
  afterAmount: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    textAlign: "right",
  },
  resultStatus: {
    width: 200,
    flexShrink: 0,
    color: tokens.registerSuccess,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  resultAction: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    width: 120,
    flexShrink: 0,
    color: tokens.primary,
    textAlign: "right",
    textDecoration: "none",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  resultPrimary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: 32,
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
    borderRadius: tokens.radiusControl,
    fontSize: tokens.fontSizeControl,
    fontWeight: tokens.fontWeightMedium,
    lineHeight: tokens.lineHeight16Px,
    textDecoration: "none",
    ":focus-visible": { outline: tokens.setupControlFocus, outlineOffset: 2 },
  },
  evidence: {
    width: 210,
    flexShrink: 0,
    fontSize: tokens.fontSizeControl,
    color: tokens.mutedForeground,
    lineHeight: tokens.lineHeight16Px,
  },
  treatment: {
    width: 200,
    flexShrink: 0,
    fontSize: tokens.fontSizeControl,
    color: tokens.mutedForeground,
    lineHeight: tokens.lineHeight16Px,
  },
  amount: {
    width: 100,
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  resultAmount: { display: "flex", flexWrap: "wrap", justifyContent: "flex-end" },
  summaryLabel: {
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.captionForeground,
  },
  summaryTitle: {
    marginTop: 2,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.mutedForeground,
  },
  postingTitle: {
    marginTop: 22,
    marginBottom: 6,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.captionForeground,
  },
  postingLine: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 32,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.rowDivider,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  firstPostingLine: { borderTopColor: tokens.border },
  postingDescription: { flexGrow: 1 },
  postingAmount: { fontVariantNumeric: "tabular-nums" },
  lastPostingLine: {
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rowDivider,
  },
  note: {
    marginTop: 12,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight18Px,
    color: tokens.mutedForeground,
  },
  footer: { marginTop: "auto", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 },
  heading: {
    margin: 0,
    marginTop: 2,
    fontSize: tokens.fontSizeLg,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight22Px,
  },
});

export function WorkGroupPanel({
  children,
  detail,
  title,
  breadcrumb,
  context,
  onClose,
  dismissible,
}: {
  children: ReactNode;
  detail: ReactNode;
  title: string;
  breadcrumb: string;
  context: string;
  onClose: () => void;
  dismissible: boolean;
}) {
  return (
    <Dialog.Root
      open
      disablePointerDismissal={!dismissible}
      onOpenChange={(open, event) => {
        if (!dismissible) {
          event.cancel();

          return;
        }

        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Popup {...stylex.props(styles.popup)}>
          <header {...stylex.props(styles.top)}>
            <span {...stylex.props(styles.breadcrumb)}>{breadcrumb}</span>
            <span {...stylex.props(styles.breadcrumb)}>/</span>
            <Dialog.Title {...stylex.props(styles.title)}>{title}</Dialog.Title>
            <span {...stylex.props(styles.context)}>{context}</span>
          </header>
          <div {...stylex.props(styles.body)}>
            <div {...stylex.props(styles.list)}>{children}</div>
            <aside {...stylex.props(styles.detail)}>{detail}</aside>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function WorkGroupSection({
  children,
  count,
  qualifier,
}: {
  children: ReactNode;
  count?: number;
  qualifier?: string;
}) {
  return (
    <div {...stylex.props(styles.section)}>
      {children}
      {count !== undefined ? <span {...stylex.props(styles.sectionCount)}>{count}</span> : null}
      {qualifier ? <span {...stylex.props(styles.qualifier)}>{qualifier}</span> : null}
    </div>
  );
}

export function WorkGroupHeading({ children }: { children: ReactNode }) {
  return <h2 {...stylex.props(styles.heading)}>{children}</h2>;
}

export function WorkGroupRow({
  title,
  amount,
  evidence,
  treatment,
  selected,
  disabled,
  changed = false,
  onSelect,
  children,
  href,
  individual = false,
}: {
  title: string;
  amount: string;
  evidence: string;
  treatment: string;
  selected: boolean;
  disabled: boolean;
  changed?: boolean;
  onSelect: () => void;
  children: ReactNode;
  href?: string;
  individual?: boolean;
}) {
  return (
    <div {...stylex.props(styles.row, changed && styles.changed)}>
      <div {...stylex.props(styles.checkbox)}>
        <CheckboxControl
          label={null}
          disabledAppearance="preserve"
          aria-label={title}
          checked={selected}
          disabled={disabled}
          onChange={onSelect}
        />
      </div>
      <div {...stylex.props(styles.titleLane, individual && styles.individualTitle)}>
        <div>
          {href ? (
            <Link href={href} {...stylex.props(styles.rowLink)}>
              {title}
            </Link>
          ) : (
            title
          )}
        </div>
        {children}
      </div>
      <span {...stylex.props(styles.evidence)}>{evidence}</span>
      <span {...stylex.props(styles.treatment)}>{treatment}</span>
      <span {...stylex.props(styles.amount)}>{amount}</span>
    </div>
  );
}

export function WorkGroupSummary({
  label,
  count,
  title,
}: {
  label: string;
  count: string;
  title: string;
}) {
  return (
    <div>
      <div {...stylex.props(styles.summaryLabel)}>{label}</div>
      <h2 {...stylex.props(styles.heading)}>{count}</h2>
      {title ? <div {...stylex.props(styles.summaryTitle)}>{title}</div> : null}
    </div>
  );
}

export function WorkGroupCaption({ children, changed }: { children: ReactNode; changed: boolean }) {
  return (
    <div {...stylex.props(styles.rowCaption, changed && styles.changedCaption)}>{children}</div>
  );
}

export function WorkGroupPosting({
  title,
  lines,
  presentation = "amounts",
}: {
  title: string;
  lines: readonly { id: string; description: string; amount: string }[];
  presentation?: "amounts" | "status";
}) {
  return (
    <div>
      <div {...stylex.props(styles.postingTitle)}>{title}</div>
      {lines.map((line, index) => (
        <div
          key={line.id}
          {...stylex.props(
            styles.postingLine,
            index === 0 && styles.firstPostingLine,
            index === lines.length - 1 && styles.lastPostingLine,
          )}
        >
          <div {...stylex.props(styles.postingDescription)}>{line.description}</div>
          <div
            {...stylex.props(presentation === "status" ? styles.afterAmount : styles.postingAmount)}
          >
            {line.amount}
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkGroupNote({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.note)}>{children}</div>;
}

export function WorkGroupFooter({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.footer)}>{children}</div>;
}

export function WorkGroupListNote({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.listNote)}>{children}</div>;
}

export function WorkGroupCancel({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="ghost" disabled={disabled} onClick={onClick} styleX={styles.cancel}>
      {children}
    </Button>
  );
}

export function WorkGroupPost({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button disabled={disabled} onClick={onClick} styleX={styles.post}>
      {children}
    </Button>
  );
}

function ResultCheck() {
  return (
    <svg
      {...stylex.props(styles.resultCheck)}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M4.6 7.2l1.7 1.7 3.1-3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WorkGroupResultBanner({ children }: { children: ReactNode }) {
  return (
    <div {...stylex.props(styles.resultBanner)}>
      <ResultCheck />
      {children}
    </div>
  );
}

export function WorkGroupResultRow({
  title,
  caption,
  amount,
  status,
  posted,
  href,
  action,
}: {
  title: string;
  caption?: string;
  amount: string;
  status: string;
  posted: boolean;
  href?: string;
  action?: string;
}) {
  return (
    <div {...stylex.props(styles.row, !posted && styles.excludedResult)}>
      <div {...stylex.props(styles.checkbox, posted && styles.resultIcon)}>
        {posted ? <ResultCheck /> : null}
      </div>
      <div {...stylex.props(styles.titleLane, !posted && styles.individualTitle)}>
        <div>{title}</div>
        {caption ? <WorkGroupCaption changed={false}>{caption}</WorkGroupCaption> : null}
      </div>
      <div {...stylex.props(styles.resultStatus, !posted && styles.changedCaption)}>{status}</div>
      <div {...stylex.props(styles.amount, styles.resultAmount)}>{amount}</div>
      {href ? (
        <Link href={href} {...stylex.props(styles.resultAction)}>
          {action}
        </Link>
      ) : (
        <div {...stylex.props(styles.resultAction)} />
      )}
    </div>
  );
}

export function WorkGroupResultAction({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Link href={href} {...stylex.props(styles.resultPrimary)}>
      {children}
    </Link>
  );
}

export function WorkGroupResultControls({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.resultControls)}>{children}</div>;
}

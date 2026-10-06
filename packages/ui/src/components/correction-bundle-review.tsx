import { Fragment, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Badge, type BadgeProps } from "@open-erp/ui/components/badge";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  exampleBadge: { backgroundColor: tokens.sidebar, color: tokens.mutedForeground },
  changesLabel: { marginBlockStart: 20 },
  changeNote: { marginBlockStart: 8 },
  asideNote: { marginBlockStart: 12, fontSize: tokens.fontSizeXs },
  asideStepsLabel: { marginBlockStart: 20 },
  consequencesLabel: { marginBlockStart: 16 },
  digestAbbreviation: { textDecoration: "none" },
  footerHint: { fontSize: tokens.fontSizeXs, color: tokens.captionForeground },
  firstBorder: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
  },
  reviewBadge: { height: 22, fontSize: tokens.fontSizeXs, fontWeight: tokens.fontWeightNormal },
  workspace: {
    backgroundColor: tokens.card,
    minHeight: "100dvh",
    marginInline: tokens.spaceNegative5,
    marginBlockStart: tokens.spaceNegative4,
    marginBlockEnd: tokens.spaceNegative8,
    minWidth: 0,
  },
  warning: {
    display: "flex",
    alignItems: "center",
    minHeight: 40,
    marginBlockStart: 12,
    paddingInline: 12,
    gap: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.warningBorder,
    borderRadius: tokens.radiusControl,
    backgroundColor: tokens.warning,
    color: tokens.warningForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight18Px,
  },
  warningIcon: {
    width: 12,
    height: 12,
    flexShrink: 0,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderRadius: tokens.radiusControl,
    borderColor: tokens.warningForeground,
  },
  afterWarning: { marginBlockStart: 16 },
  dependencyName: {
    display: "block",
    flexShrink: 0,
    width: 230,
    textAlign: "start",
    paddingInlineStart: 8,
    fontWeight: tokens.fontWeightNormal,
  },
  dependencyValue: {
    display: "block",
    flexShrink: 0,
    width: 170,
    textAlign: "start",
    color: tokens.mutedForeground,
    padding: 0,
  },
  dependencyStatus: { display: "block", flexGrow: 1, textAlign: "end", paddingInlineEnd: 8 },
  dependencyRow: {
    display: "flex",
    alignItems: "start",
    paddingBlockStart: 8,
    height: 34,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.secondary,
  },
  changedRow: { backgroundColor: tokens.warning, borderBlockEndColor: tokens.warningBorder },
  currentStep: { backgroundColor: tokens.warning, borderBlockStartColor: tokens.warningBorder },
  currentChanged: { color: tokens.foreground, fontWeight: tokens.fontWeightSemibold },
  basisNote: {
    marginBlockStart: 10,
    marginBlockEnd: 0,
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight18Px,
  },
  plainFacts: { minHeight: 34, paddingBlockStart: 8 },
  plainFactLabel: { color: tokens.foreground },
  actionFooter: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    minHeight: 28,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  breadcrumbText: { color: tokens.captionForeground, fontWeight: tokens.fontWeightMedium },
  breadcrumbEnd: { color: tokens.foreground, fontWeight: tokens.fontWeightSemibold },
  breadcrumbSeparator: { color: tokens.captionForeground, fontSize: tokens.fontSizeBase },
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space2,
    minHeight: 48,
    paddingInline: tokens.space5,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  body: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 400px",
    minHeight: "calc(100dvh - 48px)",
    "@media (max-width: 1100px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  main: { minWidth: 0, paddingInline: tokens.space8, paddingBlockStart: tokens.space4 },
  heading: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginBlockStart: tokens.space3,
  },
  title: {
    margin: 0,
    overflowWrap: "anywhere",
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight22Px,
  },
  description: {
    marginBlockStart: tokens.space1,
    marginBlockEnd: 0,
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight18Px,
  },
  label: {
    marginBlockStart: 18,
    marginBlockEnd: tokens.space1_5,
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  tableScroll: { overflowX: "auto", minWidth: 0 },
  table: {
    display: "block",
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    tableLayout: "fixed",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  tableHeader: {
    display: "flex",
    alignItems: "center",
    height: 28,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: tokens.sidebar,
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
  },
  cellText: { display: "block", whiteSpace: "pre-wrap" },
  tableSection: { display: "block" },
  tableNote: {
    marginBlockStart: 6,
    marginBlockEnd: 0,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight18Px,
    color: tokens.mutedForeground,
  },
  retainedAmount: { color: tokens.captionForeground },
  headerAccount: { fontWeight: tokens.fontWeightSemibold },
  account: {
    display: "block",
    flexGrow: 1,
    textAlign: "start",
    paddingInlineStart: tokens.space2,
    paddingBlock: 0,
    paddingInlineEnd: 0,
    fontWeight: tokens.fontWeightNormal,
  },
  amount: {
    display: "block",
    flexShrink: 0,
    width: 108,
    textAlign: "end",
    padding: 0,
    fontWeight: "inherit",
  },
  replacement: { width: 112 },
  net: { width: 96, paddingInlineEnd: tokens.space2 },
  row: {
    display: "flex",
    alignItems: "start",
    paddingBlockStart: 5,
    height: 28,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.secondary,
  },
  footerRow: { borderBlockEndColor: tokens.border, fontWeight: tokens.fontWeightSemibold },
  dateRow: {
    display: "flex",
    alignItems: "center",
    height: 22,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.captionForeground,
  },
  note: {
    marginBlockStart: tokens.space2,
    marginBlockEnd: 0,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight18Px,
    color: tokens.mutedForeground,
  },
  consequences: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" },
  effect: {
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.secondary,
  },
  effectFirst: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
  },
  effectLast: { borderBlockEndColor: tokens.border },
  effectName: {
    width: 170,
    padding: "7px 0 7px 8px",
    textAlign: "start",
    verticalAlign: "top",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    fontWeight: tokens.fontWeightNormal,
  },
  effectDetail: {
    padding: "7px 12px 7px 0",
    verticalAlign: "top",
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
  },
  effectStatus: {
    width: 100,
    padding: "7px 8px 7px 0",
    verticalAlign: "top",
    textAlign: "end",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  unchanged: { color: tokens.successForeground },
  changed: { color: tokens.warningForeground },
  unrelated: { color: tokens.captionForeground },
  blocked: { color: tokens.destructive },
  aside: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.border,
    padding: "24px 24px 20px",
  },
  asideLabel: {
    margin: 0,
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
  },
  asideTitle: {
    marginBlockStart: 2,
    marginBlockEnd: 0,
    fontSize: tokens.fontSizeBase,
    lineHeight: tokens.lineHeight22Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  facts: {
    marginBlockStart: 14,
  },
  fact: {
    paddingBlockStart: 7,
    alignItems: "start",
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.space3,
    minHeight: 32,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.secondary,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  factLabel: { color: tokens.mutedForeground, whiteSpace: "pre-wrap" },
  factValue: { textAlign: "end", overflowWrap: "anywhere", whiteSpace: "pre-wrap" },
  digest: { fontFamily: tokens.fontMono },
  steps: {
    padding: 0,
    margin: 0,
    listStyle: "none",
  },
  step: {
    paddingBlockStart: 8,
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.space3,
    alignItems: "start",
    minHeight: 34,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.secondary,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  lastStep: {
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.secondary,
  },
  stepStatus: { textAlign: "end", color: tokens.mutedForeground },
  action: { display: "grid", gap: 10, marginBlockStart: "auto", paddingBlockStart: tokens.space5 },
});

export type CorrectionEffectRow = {
  id: string;
  name: string;
  detail: ReactNode;
  status: string;
  tone: "unchanged" | "changed" | "unrelated" | "blocked";
};

export function CorrectionBundleWorkspace(props: {
  breadcrumb: ReactNode;
  title: string;
  status: ReactNode;
  description: ReactNode;
  children: ReactNode;
  aside: ReactNode;
  warning?: ReactNode;
}) {
  return (
    <section {...stylex.props(styles.workspace)}>
      <header {...stylex.props(styles.header)}>{props.breadcrumb}</header>
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.main)}>
          {props.warning ? (
            <div role="alert" {...stylex.props(styles.warning)}>
              <span aria-hidden="true" {...stylex.props(styles.warningIcon)} />
              {props.warning}
            </div>
          ) : null}
          <div {...stylex.props(styles.heading, !!props.warning && styles.afterWarning)}>
            <h1 {...stylex.props(styles.title)}>{props.title}</h1>
            {props.status}
          </div>
          <p {...stylex.props(styles.description)}>{props.description}</p>
          {props.children}
        </div>
        <aside {...stylex.props(styles.aside)}>{props.aside}</aside>
      </div>
    </section>
  );
}

export function CorrectionBalanceTable(props: {
  title: string;
  accountLabel: string;
  columns: readonly [string, string, string, string];
  rows: ReadonlyArray<{
    id: string;
    account: string;
    amounts: readonly [string, string, string, string];
    mutedAmounts?: readonly [boolean, boolean, boolean, boolean];
  }>;
  dates: readonly [string, string, string];
  datesLabel: string;
  explanation: ReactNode;
}) {
  return (
    <>
      <h2 {...stylex.props(styles.label)}>{props.title}</h2>
      <div {...stylex.props(styles.tableScroll)}>
        <table aria-label={props.title} {...stylex.props(styles.table)}>
          <thead {...stylex.props(styles.tableSection)}>
            <tr {...stylex.props(styles.tableHeader)}>
              <th scope="col" {...stylex.props(styles.account, styles.headerAccount)}>
                <span {...stylex.props(styles.cellText)}>{props.accountLabel}</span>
              </th>
              {props.columns.map((label, index) => (
                <th
                  key={label}
                  scope="col"
                  {...stylex.props(
                    styles.amount,
                    index === 2 && styles.replacement,
                    index === 3 && styles.net,
                  )}
                >
                  <span {...stylex.props(styles.cellText)}>{label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody {...stylex.props(styles.tableSection)}>
            <tr {...stylex.props(styles.dateRow)}>
              <th scope="row" {...stylex.props(styles.account)}>
                <span {...stylex.props(styles.cellText)}>{props.datesLabel}</span>
              </th>
              {props.dates.map((date, index) => (
                <td key={index} {...stylex.props(styles.amount, index === 2 && styles.replacement)}>
                  <span {...stylex.props(styles.cellText)}>{date}</span>
                </td>
              ))}
              <td {...stylex.props(styles.amount, styles.net)} />
            </tr>
            {props.rows.map((row, index) => (
              <tr
                key={row.id}
                {...stylex.props(styles.row, index === props.rows.length - 1 && styles.footerRow)}
              >
                <th
                  scope="row"
                  {...stylex.props(
                    styles.account,
                    index === props.rows.length - 1 && styles.footerRow,
                    index === props.rows.length - 1 && styles.headerAccount,
                  )}
                >
                  <span {...stylex.props(styles.cellText)}>{row.account}</span>
                </th>
                {row.amounts.map((amount, column) => (
                  <td
                    key={column}
                    {...stylex.props(
                      styles.amount,
                      index === props.rows.length - 1 && styles.footerRow,
                      row.mutedAmounts?.[column] && styles.retainedAmount,
                      column === 2 && styles.replacement,
                      column === 3 && styles.net,
                    )}
                  >
                    <span {...stylex.props(styles.cellText)}>{amount}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p {...stylex.props(styles.tableNote)}>{props.explanation}</p>
    </>
  );
}

export function CorrectionConsequences({
  title,
  rows,
}: {
  title: string;
  rows: ReadonlyArray<CorrectionEffectRow>;
}) {
  return (
    <>
      <h2 {...stylex.props(styles.label, styles.consequencesLabel)}>{title}</h2>
      <table aria-label={title} {...stylex.props(styles.consequences)}>
        <tbody {...stylex.props(styles.tableSection)}>
          {rows.map((row, index) => (
            <tr
              key={row.id}
              {...stylex.props(
                styles.effect,
                index === 0 && styles.effectFirst,
                index === rows.length - 1 && styles.effectLast,
              )}
            >
              <th scope="row" {...stylex.props(styles.effectName)}>
                {row.name}
              </th>
              <td {...stylex.props(styles.effectDetail)}>{row.detail}</td>
              <td {...stylex.props(styles.effectStatus, styles[row.tone])}>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function CorrectionApprovalPanel(props: {
  label: string;
  title: string;
  description?: ReactNode;
  facts: ReadonlyArray<{
    label: string;
    value: ReactNode;
    digest?: boolean;
    tone?: "unchanged" | "changed";
  }>;
  basisNote?: ReactNode;
  plainFacts?: boolean;
  footer?: ReactNode;
  stepsLabel: string;
  steps: ReadonlyArray<{
    title: string;
    status: string;
    tone?: "unchanged" | "changed";
    current?: boolean;
  }>;
  note: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <p {...stylex.props(styles.asideLabel)}>{props.label}</p>
      <h2 {...stylex.props(styles.asideTitle)}>{props.title}</h2>
      {props.description ? <p {...stylex.props(styles.description)}>{props.description}</p> : null}
      <div {...stylex.props(styles.facts)}>
        {props.facts.map((fact, index) => (
          <div
            key={fact.label}
            {...stylex.props(
              styles.fact,
              index === 0 && styles.firstBorder,
              props.plainFacts && styles.plainFacts,
            )}
          >
            <span {...stylex.props(styles.factLabel, props.plainFacts && styles.plainFactLabel)}>
              {fact.label}
            </span>
            <span
              {...stylex.props(
                styles.factValue,
                fact.digest && styles.digest,
                fact.tone && styles[fact.tone],
              )}
            >
              {fact.value}
            </span>
          </div>
        ))}
      </div>
      {props.basisNote ? <p {...stylex.props(styles.basisNote)}>{props.basisNote}</p> : null}
      <h3 {...stylex.props(styles.label, styles.asideStepsLabel)}>{props.stepsLabel}</h3>
      <ol {...stylex.props(styles.steps)}>
        {props.steps.map((step, index) => (
          <li
            key={step.title}
            {...stylex.props(
              styles.step,
              index === 0 && styles.firstBorder,
              index === props.steps.length - 1 && styles.lastStep,
              step.current && styles.currentStep,
            )}
          >
            <span>{step.title}</span>
            <span {...stylex.props(styles.stepStatus, step.tone && styles[step.tone])}>
              {step.status}
            </span>
          </li>
        ))}
      </ol>
      {props.note ? <p {...stylex.props(styles.note, styles.asideNote)}>{props.note}</p> : null}
      <div {...stylex.props(styles.action)}>
        {props.children}
        {props.footer ? <div {...stylex.props(styles.actionFooter)}>{props.footer}</div> : null}
      </div>
    </>
  );
}

export function CorrectionDifferenceTable(props: {
  title: string;
  accountLabel: string;
  columns: readonly [string, string, string];
  rows: ReadonlyArray<{ id: string; account: string; amounts: readonly [string, string, string] }>;
  explanation?: ReactNode;
}) {
  return (
    <>
      <h2 {...stylex.props(styles.label)}>{props.title}</h2>
      <div {...stylex.props(styles.tableScroll)}>
        <table aria-label={props.title} {...stylex.props(styles.table)}>
          <thead {...stylex.props(styles.tableSection)}>
            <tr {...stylex.props(styles.tableHeader)}>
              <th scope="col" {...stylex.props(styles.account, styles.headerAccount)}>
                {props.accountLabel}
              </th>
              {props.columns.map((label) => (
                <th key={label} scope="col" {...stylex.props(styles.amount)}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody {...stylex.props(styles.tableSection)}>
            {props.rows.map((row) => (
              <tr key={row.id} {...stylex.props(styles.row)}>
                <th scope="row" {...stylex.props(styles.account)}>
                  {row.account}
                </th>
                {row.amounts.map((value, index) => (
                  <td key={index} {...stylex.props(styles.amount)}>
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.explanation ? <p {...stylex.props(styles.tableNote)}>{props.explanation}</p> : null}
    </>
  );
}

export function CorrectionDependencyTable(props: {
  title: string;
  columns: readonly [string, string, string, string];
  rows: ReadonlyArray<{
    id: string;
    name: ReactNode;
    before: ReactNode;
    current: ReactNode;
    status: string;
    changed?: boolean;
    digest?: boolean;
  }>;
}) {
  return (
    <>
      <h2 {...stylex.props(styles.label)}>{props.title}</h2>
      <div {...stylex.props(styles.tableScroll)}>
        <table aria-label={props.title} {...stylex.props(styles.table)}>
          <thead {...stylex.props(styles.tableSection)}>
            <tr {...stylex.props(styles.tableHeader)}>
              {props.columns.map((column, index) => (
                <th
                  key={index}
                  scope="col"
                  {...stylex.props(
                    index === 0
                      ? styles.dependencyName
                      : index < 3
                        ? styles.dependencyValue
                        : styles.dependencyStatus,
                    styles.headerAccount,
                  )}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody {...stylex.props(styles.tableSection)}>
            {props.rows.map((row, index) => (
              <tr
                key={row.id}
                {...stylex.props(
                  styles.dependencyRow,
                  row.changed && styles.changedRow,
                  index === props.rows.length - 1 && styles.effectLast,
                )}
              >
                <th scope="row" {...stylex.props(styles.dependencyName)}>
                  {row.name}
                </th>
                <td {...stylex.props(styles.dependencyValue, row.digest && styles.digest)}>
                  {row.before}
                </td>
                <td
                  {...stylex.props(
                    styles.dependencyValue,
                    row.digest && styles.digest,
                    row.changed && styles.currentChanged,
                  )}
                >
                  {row.current}
                </td>
                <td
                  {...stylex.props(
                    styles.dependencyStatus,
                    row.changed || row.digest ? styles.changed : styles.unchanged,
                  )}
                >
                  {row.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function CorrectionChangeFacts(props: {
  title: string;
  rows: ReadonlyArray<{ label: string; value: ReactNode }>;
  note: ReactNode;
}) {
  return (
    <>
      <h2 {...stylex.props(styles.label, styles.changesLabel)}>{props.title}</h2>
      <div>
        {props.rows.map((row, index) => (
          <div key={row.label} {...stylex.props(styles.fact, index === 0 && styles.firstBorder)}>
            <span {...stylex.props(styles.factLabel)}>{row.label}</span>
            <span {...stylex.props(styles.factValue)}>{row.value}</span>
          </div>
        ))}
      </div>
      <p {...stylex.props(styles.tableNote, styles.changeNote)}>{props.note}</p>
    </>
  );
}

export function CorrectionBreadcrumb(props: { segments: ReadonlyArray<ReactNode> }) {
  return props.segments.map((segment, index) => (
    <Fragment key={index}>
      {index > 0 ? (
        <span aria-hidden="true" {...stylex.props(styles.breadcrumbSeparator)}>
          ›
        </span>
      ) : null}
      <span
        {...stylex.props(
          index === props.segments.length - 1 ? styles.breadcrumbEnd : styles.breadcrumbText,
        )}
      >
        {segment}
      </span>
    </Fragment>
  ));
}

export function CorrectionReviewBadge({ example, ...props }: BadgeProps & { example?: boolean }) {
  return <Badge {...props} styleX={[styles.reviewBadge, example && styles.exampleBadge]} />;
}

export function CorrectionDigest(props: { value: string; children: ReactNode }) {
  return (
    <abbr title={props.value} {...stylex.props(styles.digestAbbreviation)}>
      {props.children}
    </abbr>
  );
}

export function CorrectionFooterHint(props: { children: ReactNode }) {
  return <span {...stylex.props(styles.footerHint)}>{props.children}</span>;
}

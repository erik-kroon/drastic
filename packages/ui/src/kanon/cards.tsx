import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { useKanonCopy } from "@open-erp/ui/kanon/copy";
import { StatusIcon, statusTextStyle, type Status } from "@open-erp/ui/kanon/status";
import { kanon } from "@open-erp/ui/theme/kanon.stylex";

const styles = stylex.create({
  card: {
    borderColor: kanon.colorRule,
    borderRadius: kanon.radiusCard,
    borderStyle: "solid",
    borderWidth: 1,
    display: "flex",
    flexDirection: "column",
    fontFamily: kanon.fontUi,
    margin: 0,
    paddingInline: kanon.space4,
  },
  row: {
    alignItems: "center",
    borderBottomColor: kanon.colorRule,
    borderBottomStyle: { default: "solid", ":last-child": "none" },
    borderBottomWidth: 1,
    display: "flex",
    gap: kanon.space2,
    minHeight: kanon.sizeCardRow,
  },
  headRow: { minHeight: kanon.space8 },
  label: {
    color: kanon.colorCaption,
    flexShrink: 0,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
    width: kanon.sizeLabelColumn,
  },
  value: {
    color: kanon.colorText,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
    minWidth: 0,
  },
  account: {
    color: kanon.colorText,
    flexGrow: 1,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  head: { color: kanon.colorCaption, fontSize: kanon.textCaption, lineHeight: kanon.leadingBody },
  number: {
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
    width: kanon.sizeLedgerColumn,
  },
  signedNumber: { width: kanon.sizeAmountColumn, overflowWrap: "anywhere" },
  total: { fontWeight: kanon.weightSemibold },
  compareLabel: {
    color: kanon.colorCaption,
    flexShrink: 0,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
    width: kanon.sizeCompareLabel,
  },
  compareValue: {
    color: kanon.colorText,
    flexBasis: 0,
    flexGrow: 1,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  missing: { color: kanon.colorCaption },
  verdict: { display: "flex", flexShrink: 0, width: kanon.sizeIcon },
});

export type Fact = { label: string; value: ReactNode; status?: Status };

/** Label and value pairs in a card: dates, account, payment state. */
export function FactCard({ facts }: { facts: ReadonlyArray<Fact> }) {
  return (
    <dl {...stylex.props(styles.card)}>
      {facts.map((fact) => (
        <div key={fact.label} {...stylex.props(styles.row)}>
          <dt {...stylex.props(styles.label)}>{fact.label}</dt>
          <dd
            {...stylex.props(
              styles.value,
              fact.status !== undefined && statusTextStyle(fact.status),
            )}
          >
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type LedgerLine = { account: string; debit?: string; credit?: string };

/**
 * Posting lines with debit and credit in separate columns. An empty cell stays empty, never 0,00.
 * Pass `total` for posted vouchers; proposals may omit it.
 */
export function LedgerCard({
  lines,
  total,
  signed = false,
}: {
  lines: ReadonlyArray<LedgerLine>;
  total?: { debit: string; credit: string };
  signed?: boolean;
}) {
  const copy = useKanonCopy();

  return (
    <div role="table" {...stylex.props(styles.card)}>
      {!signed ? (
        <div role="row" {...stylex.props(styles.row, styles.headRow)}>
          <span role="columnheader" {...stylex.props(styles.account, styles.head)}>
            {copy.account}
          </span>
          <span role="columnheader" {...stylex.props(styles.head, styles.number)}>
            {copy.debit}
          </span>
          <span role="columnheader" {...stylex.props(styles.head, styles.number)}>
            {copy.credit}
          </span>
        </div>
      ) : null}
      {lines.map((line) => (
        <div
          role="row"
          key={`${line.account}/${line.debit === undefined ? "credit" : "debit"}`}
          {...stylex.props(styles.row)}
        >
          <span role="cell" title={line.account} {...stylex.props(styles.account)}>
            {line.account}
          </span>
          {signed ? (
            <span role="cell" {...stylex.props(styles.value, styles.number, styles.signedNumber)}>
              {line.debit ?? (line.credit ? `−${line.credit}` : undefined)}
            </span>
          ) : (
            <>
              <span role="cell" {...stylex.props(styles.value, styles.number)}>
                {line.debit}
              </span>
              <span role="cell" {...stylex.props(styles.value, styles.number)}>
                {line.credit}
              </span>
            </>
          )}
        </div>
      ))}
      {total !== undefined && (
        <div role="row" {...stylex.props(styles.row)}>
          <span role="cell" {...stylex.props(styles.account, styles.total)}>
            {copy.total}
          </span>
          <span role="cell" {...stylex.props(styles.value, styles.number, styles.total)}>
            {total.debit}
          </span>
          <span role="cell" {...stylex.props(styles.value, styles.number, styles.total)}>
            {total.credit}
          </span>
        </div>
      )}
    </div>
  );
}

export type Comparison = { label: string; left?: string; right?: string; matches: boolean };

/**
 * Evidence before claims: two sources side by side with a verdict per field.
 * A missing value shows the "missing" word and can never count as a match.
 */
export function CompareCard({
  leftTitle,
  rightTitle,
  rows,
}: {
  leftTitle: string;
  rightTitle: string;
  rows: ReadonlyArray<Comparison>;
}) {
  const copy = useKanonCopy();

  return (
    <div role="table" {...stylex.props(styles.card)}>
      <div role="row" {...stylex.props(styles.row, styles.headRow)}>
        <span {...stylex.props(styles.compareLabel)} />
        <span role="columnheader" {...stylex.props(styles.compareValue, styles.head)}>
          {leftTitle}
        </span>
        <span role="columnheader" {...stylex.props(styles.compareValue, styles.head)}>
          {rightTitle}
        </span>
        <span {...stylex.props(styles.verdict)} />
      </div>
      {rows.map((row) => {
        const matches = row.matches && row.left !== undefined && row.right !== undefined;

        return (
          <div role="row" key={row.label} {...stylex.props(styles.row)}>
            <span role="rowheader" {...stylex.props(styles.compareLabel)}>
              {row.label}
            </span>
            <span
              role="cell"
              {...stylex.props(styles.compareValue, row.left === undefined && styles.missing)}
            >
              {row.left ?? copy.missing}
            </span>
            <span
              role="cell"
              {...stylex.props(styles.compareValue, row.right === undefined && styles.missing)}
            >
              {row.right ?? copy.missing}
            </span>
            <span
              role="cell"
              aria-label={matches ? copy.matches : copy.differs}
              {...stylex.props(styles.verdict)}
            >
              <StatusIcon status={matches ? "done" : "needsYou"} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

import { useId, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { Link } from "@open-erp/ui/components/link";

const assetActionStyles = stylex.create({
  page: {
    boxSizing: "border-box",
    paddingInlineStart: tokens.space8,
    paddingInlineEnd: tokens.space0,
    paddingBlockStart: 28,
    width: 900,
    maxWidth: "calc(100% + 40px)",
    marginInline: tokens.spaceNegative5,
    marginBlockStart: tokens.spaceNegative4,
    "@media (max-width: 767px)": {
      paddingInline: tokens.space4,
      paddingBlockStart: tokens.space4,
      marginInline: tokens.spaceNegative4,
      maxWidth: "calc(100% + 32px)",
    },
  },
  success: {
    backgroundColor: tokens.registerSuccessBackground,
    color: tokens.registerSuccess,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.registerSuccessBorder,
    borderRadius: tokens.radiusStatusBadge,
    paddingBlock: 2,
    paddingInline: 8,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
  },
  metadata: {
    marginBlock: 0,
    marginBlockStart: 4,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight18Px,
    color: tokens.mutedForeground,
  },
  metrics: { display: "flex", flexWrap: "wrap", gap: 48, marginBlockStart: 16 },
  metricLabel: {
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.captionForeground,
  },
  metricValue: {
    fontSize: tokens.fontSize2xl,
    lineHeight: tokens.lineHeight30Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  mutedMetric: { color: tokens.captionForeground },
  journalRow: {
    height: 32,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  journalLabel: { paddingInlineStart: 8, textAlign: "left" },
  journalCredit: { paddingInlineEnd: 8 },
  breadcrumbs: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  breadcrumbLink: { color: tokens.primary },
  titleRow: { display: "flex", alignItems: "center", gap: 10, marginBlockStart: 12 },
  example: {
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight18Px,
    color: tokens.captionForeground,
    backgroundColor: tokens.sidebar,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusFull,
    paddingInline: 8,
    paddingBlock: 1,
  },
  title: {
    marginBlockStart: 0,
    marginBlockEnd: 0,
    fontSize: tokens.fontSizeBase,
    lineHeight: tokens.lineHeight22Px,
    fontWeight: tokens.fontWeightSemibold,
  },
  section: {
    marginBlockStart: 20,
    marginBlockEnd: 6,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.captionForeground,
  },
  afterAlert: { marginBlockStart: 22 },
  note: {
    marginBlockStart: 8,
    marginBlockEnd: 0,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight18Px,
    color: tokens.mutedForeground,
  },
  error: {
    marginBlockStart: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.destructiveOnBorder30,
    borderRadius: tokens.radiusControl,
    backgroundColor: tokens.destructiveBackground,
    color: tokens.destructive,
    paddingBlock: 10,
    paddingInline: 12,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight18Px,
  },
  facts: { margin: 0 },
  fact: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    minHeight: 32,
    alignItems: "center",
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    ":first-child": {
      borderBlockStartWidth: 1,
      borderBlockStartStyle: "solid",
      borderBlockStartColor: tokens.border,
    },
  },
  value: { margin: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" },
  emphasis: { fontWeight: tokens.fontWeightSemibold },
  actions: { display: "flex", flexWrap: "wrap", gap: 10, marginBlockStart: 16 },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  tableHead: {
    backgroundColor: tokens.sidebar,
    borderBlockWidth: 1,
    borderBlockStyle: "solid",
    borderBlockColor: tokens.border,
    height: 27,
    fontSize: tokens.fontSizeXs,
    color: tokens.mutedForeground,
    textAlign: "left",
  },
  row: {
    height: 36,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  selected: { backgroundColor: tokens.sourceSelected },
  unavailable: { color: tokens.captionForeground },
  occupiedState: { color: tokens.destructive },
  freeState: { color: tokens.registerSuccess },
  headerCell: { fontWeight: tokens.fontWeightSemibold, padding: 0 },
  radio: { width: 36, textAlign: "center" },
  ordinal: { width: 80 },
  amount: {
    width: 120,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    "@media (max-width: 767px)": { width: 90 },
  },
  state: {
    width: 220,
    textAlign: "right",
    paddingInlineEnd: 8,
    "@media (max-width: 767px)": { width: 100 },
  },
  description: { overflowWrap: "anywhere" },
  radioInput: { accentColor: tokens.primary, margin: 0, verticalAlign: "middle" },
});

export function AssetActionLayout(props: {
  title: string;
  assetName: string;
  backHref: string;
  synthetic?: boolean;
  posted?: boolean;
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(assetActionStyles.page)}>
      <nav aria-label="Bokföring" {...stylex.props(assetActionStyles.breadcrumbs)}>
        <Link href={props.backHref} {...stylex.props(assetActionStyles.breadcrumbLink)}>
          Bokföring
        </Link>
        <span>/</span>
        <Link href={props.backHref} {...stylex.props(assetActionStyles.breadcrumbLink)}>
          Tillgångar
        </Link>
        <span>/</span>
        <span>{props.assetName}</span>
      </nav>
      <div {...stylex.props(assetActionStyles.titleRow)}>
        <h1 {...stylex.props(assetActionStyles.title)}>{props.title}</h1>
        {props.posted ? <span {...stylex.props(assetActionStyles.success)}>Bokförd</span> : null}
        {props.synthetic ? (
          <span {...stylex.props(assetActionStyles.example)}>Exempeldata</span>
        ) : null}
      </div>
      {props.children}
    </section>
  );
}

export function AssetFact(props: { label: string; value: ReactNode; emphasis?: boolean }) {
  return (
    <div {...stylex.props(assetActionStyles.fact, props.emphasis && assetActionStyles.emphasis)}>
      <dt>{props.label}</dt>
      <dd {...stylex.props(assetActionStyles.value)}>{props.value}</dd>
    </div>
  );
}

export function AssetActionSection({
  children,
  afterAlert,
}: {
  children: ReactNode;
  afterAlert?: boolean;
}) {
  return (
    <h2 {...stylex.props(assetActionStyles.section, afterAlert && assetActionStyles.afterAlert)}>
      {children}
    </h2>
  );
}

export function AssetActionNote({ children, status }: { children: ReactNode; status?: boolean }) {
  return (
    <p role={status ? "status" : undefined} {...stylex.props(assetActionStyles.note)}>
      {children}
    </p>
  );
}

export function AssetActionError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" {...stylex.props(assetActionStyles.error)}>
      {children}
    </p>
  );
}

export function AssetActionFacts({ children }: { children: ReactNode }) {
  return <dl {...stylex.props(assetActionStyles.facts)}>{children}</dl>;
}

export function AssetActionActions({ children }: { children: ReactNode }) {
  return <div {...stylex.props(assetActionStyles.actions)}>{children}</div>;
}

export function AssetInvoiceSourceTable(props: {
  rows: readonly {
    id: string;
    ordinal: number;
    description: string;
    amount: string;
    state: string;
    disabled: boolean;
  }[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const group = useId();

  return (
    <table {...stylex.props(assetActionStyles.table)}>
      <thead {...stylex.props(assetActionStyles.tableHead)}>
        <tr>
          <th
            aria-label="Välj rad"
            {...stylex.props(assetActionStyles.headerCell, assetActionStyles.radio)}
          />
          <th {...stylex.props(assetActionStyles.headerCell, assetActionStyles.ordinal)}>Rad</th>
          <th {...stylex.props(assetActionStyles.headerCell)}>Beskrivning</th>
          <th {...stylex.props(assetActionStyles.headerCell, assetActionStyles.amount)}>Belopp</th>
          <th {...stylex.props(assetActionStyles.headerCell, assetActionStyles.state)}>Läge</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row) => (
          <tr
            key={row.id}
            {...stylex.props(
              assetActionStyles.row,
              row.id === props.selected && assetActionStyles.selected,
              row.disabled && assetActionStyles.unavailable,
            )}
          >
            <td {...stylex.props(assetActionStyles.radio)}>
              <input
                type="radio"
                name={group}
                aria-label={`Rad ${row.ordinal}, ${row.description}`}
                aria-describedby={`${group}-${row.id}`}
                checked={row.id === props.selected}
                disabled={row.disabled}
                onChange={() => props.onSelect(row.id)}
                {...stylex.props(assetActionStyles.radioInput)}
              />
            </td>
            <td>Rad {row.ordinal}</td>
            <td {...stylex.props(assetActionStyles.description)}>{row.description}</td>
            <td {...stylex.props(assetActionStyles.amount)}>{row.amount}</td>
            <td
              id={`${group}-${row.id}`}
              {...stylex.props(
                assetActionStyles.state,
                row.disabled ? assetActionStyles.occupiedState : assetActionStyles.freeState,
              )}
            >
              {row.state}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AssetRevenueAcknowledgment(props: {
  checked: boolean;
  onChecked: (checked: boolean) => void;
}) {
  return (
    <label {...stylex.props(assetActionStyles.note)}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChecked(event.currentTarget.checked)}
      />{" "}
      Jag förstår att intäkten på fakturan omförs. Ingen ny kundfordran, bank eller moms bokförs.
    </label>
  );
}

export function AssetActionMetadata({ children }: { children: ReactNode }) {
  return <p {...stylex.props(assetActionStyles.metadata)}>{children}</p>;
}

export function AssetActionMetrics({
  items,
}: {
  items: readonly { label: string; value: string; muted?: boolean }[];
}) {
  return (
    <div {...stylex.props(assetActionStyles.metrics)}>
      {items.map((item) => (
        <div key={item.label}>
          <div {...stylex.props(assetActionStyles.metricLabel)}>{item.label}</div>
          <div
            {...stylex.props(
              assetActionStyles.metricValue,
              item.muted && assetActionStyles.mutedMetric,
            )}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AssetPostedJournal({
  rows,
  debit,
  credit,
}: {
  rows: readonly { id: string; label: string; debit: string; credit: string }[];
  debit: string;
  credit: string;
}) {
  return (
    <table {...stylex.props(assetActionStyles.table)}>
      <thead {...stylex.props(assetActionStyles.tableHead)}>
        <tr>
          <th {...stylex.props(assetActionStyles.headerCell, assetActionStyles.journalLabel)}>
            Konto
          </th>
          <th {...stylex.props(assetActionStyles.headerCell, assetActionStyles.amount)}>Debet</th>
          <th
            {...stylex.props(
              assetActionStyles.headerCell,
              assetActionStyles.amount,
              assetActionStyles.journalCredit,
            )}
          >
            Kredit
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} {...stylex.props(assetActionStyles.journalRow)}>
            <td {...stylex.props(assetActionStyles.journalLabel)}>{row.label}</td>
            <td {...stylex.props(assetActionStyles.amount)}>{row.debit}</td>
            <td {...stylex.props(assetActionStyles.amount, assetActionStyles.journalCredit)}>
              {row.credit}
            </td>
          </tr>
        ))}
        <tr {...stylex.props(assetActionStyles.journalRow, assetActionStyles.emphasis)}>
          <td {...stylex.props(assetActionStyles.journalLabel)}>Summa</td>
          <td {...stylex.props(assetActionStyles.amount)}>{debit}</td>
          <td {...stylex.props(assetActionStyles.amount, assetActionStyles.journalCredit)}>
            {credit}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

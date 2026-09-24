import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { InvoiceTotals } from "@open-erp/ui/components/invoice-lines";

const styles = stylex.create({
  canvas: { containerType: "inline-size", minWidth: 0 },
  paper: {
    display: "grid",
    gap: tokens.space8,
    padding: tokens.space6,
    minWidth: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusSm,
    backgroundColor: tokens.invoicePaper,
    "@container (max-width: 28rem)": { padding: tokens.space4, gap: tokens.space6 },
  },
  eyebrow: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeCompact,
    letterSpacing: tokens.trackingSection,
    textTransform: "uppercase",
    fontFamily: tokens.fontMono,
  },
  title: {
    marginBlockStart: tokens.space2,
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightMedium,
    lineHeight: tokens.lineHeightNormal,
    overflowWrap: "anywhere",
  },
  dates: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.space4,
    paddingBlockEnd: tokens.space4,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
  },
  date: {
    display: "flex",
    gap: tokens.space2,
    fontSize: tokens.fontSizeCompact,
    fontFamily: tokens.fontMono,
  },
  dateValue: { fontVariantNumeric: "tabular-nums" },
  details: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: tokens.space6,
    "@container (max-width: 22rem)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  group: { display: "grid", gap: tokens.space2, alignContent: "start", minWidth: 0 },
  primary: { fontWeight: tokens.fontWeightMedium, overflowWrap: "anywhere" },
  secondary: { color: tokens.mutedForeground, whiteSpace: "pre-line", overflowWrap: "anywhere" },
  lineTable: {
    borderCollapse: "collapse",
    width: "100%",
    fontSize: tokens.fontSizeXs,
    fontFamily: tokens.fontMono,
  },
  lineHeader: {
    paddingBlock: tokens.space3,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    color: tokens.mutedForeground,
    fontWeight: tokens.fontWeightNormal,
    textAlign: "start",
    "@container (max-width: 28rem)": { display: "none" },
  },
  lineRow: {
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    "@container (max-width: 28rem)": { display: "grid", paddingBlock: tokens.space3 },
  },
  lineCell: {
    paddingBlock: tokens.space3,
    paddingInlineEnd: tokens.space2,
    overflowWrap: "anywhere",
    "@container (max-width: 28rem)": {
      display: "flex",
      justifyContent: "space-between",
      gap: tokens.space4,
      paddingBlock: tokens.space2,
    },
  },
  number: { textAlign: "end", fontVariantNumeric: "tabular-nums" },
  mobileLabel: {
    display: "none",
    flexShrink: 0,
    whiteSpace: "nowrap",
    color: tokens.mutedForeground,
    "@container (max-width: 28rem)": { display: "inline" },
  },
  terms: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
    paddingBlockStart: tokens.space6,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
});

const statusStyles = stylex.create({
  section: {
    display: "grid",
    gap: tokens.space4,
    padding: tokens.space6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.card,
    containerType: "inline-size",
  },
  heading: {
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightMedium,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: tokens.space6,
    "@container (max-width: 38rem)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  item: {
    display: "grid",
    gap: tokens.space2,
    minWidth: 0,
    paddingBlockStart: tokens.space3,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
  },
  label: { color: tokens.mutedForeground, fontSize: tokens.fontSizeSm },
  value: { margin: 0, fontWeight: tokens.fontWeightMedium, overflowWrap: "anywhere" },
  note: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeight21Px,
  },
});

export function InvoicePreview({
  title,
  seller,
  sellerAddress,
  customer,
  address,
  dates,
  lines,
  totals,
  terms,
  labels,
}: {
  title: string;
  seller: string;
  sellerAddress: string | null;
  customer: string;
  address: string | null;
  dates: { label: string; value: string }[];
  lines: { id: string; description: string; quantity: string; net: string; tax: string }[];
  totals: { label: string; value: string; total?: boolean }[];
  terms: string | null;
  labels: {
    state: string;
    from: string;
    billTo: string;
    invoiceLines: string;
    description: string;
    qty: string;
    net: string;
    tax: string;
    paymentTerms: string;
  };
}) {
  return (
    <div {...stylex.props(styles.canvas)}>
      <article {...stylex.props(styles.paper)}>
        <header>
          <span {...stylex.props(styles.eyebrow)}>{labels.state}</span>
          <h2 {...stylex.props(styles.title)}>{title}</h2>
        </header>
        <div {...stylex.props(styles.dates)}>
          {dates.map((date) => (
            <div key={date.label} {...stylex.props(styles.date)}>
              <span {...stylex.props(styles.secondary)}>{date.label}</span>
              <span {...stylex.props(styles.dateValue)}>{date.value}</span>
            </div>
          ))}
        </div>
        <div {...stylex.props(styles.details)}>
          <section {...stylex.props(styles.group)} aria-label={labels.from}>
            <span {...stylex.props(styles.eyebrow)}>{labels.from}</span>
            <span {...stylex.props(styles.primary)}>{seller}</span>
            {sellerAddress ? (
              <span {...stylex.props(styles.secondary)}>{sellerAddress}</span>
            ) : null}
          </section>
          <section {...stylex.props(styles.group)} aria-label={labels.billTo}>
            <span {...stylex.props(styles.eyebrow)}>{labels.billTo}</span>
            <span {...stylex.props(styles.primary)}>{customer}</span>
            {address ? <span {...stylex.props(styles.secondary)}>{address}</span> : null}
          </section>
        </div>
        <table {...stylex.props(styles.lineTable)} aria-label={labels.invoiceLines}>
          <thead>
            <tr>
              {[labels.description, labels.qty, labels.net, labels.tax].map((label, index) => (
                <th
                  key={label}
                  scope="col"
                  {...stylex.props(styles.lineHeader, index > 0 && styles.number)}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} {...stylex.props(styles.lineRow)}>
                {[
                  { label: labels.description, value: line.description },
                  { label: labels.qty, value: line.quantity },
                  { label: labels.net, value: line.net },
                  { label: labels.tax, value: line.tax },
                ].map((cell, index) => (
                  <td
                    key={cell.label}
                    {...stylex.props(styles.lineCell, index > 0 && styles.number)}
                  >
                    <span {...stylex.props(styles.mobileLabel)} aria-hidden="true">
                      {cell.label}
                    </span>
                    {cell.value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <InvoiceTotals rows={totals} />
        {terms ? (
          <div {...stylex.props(styles.terms)}>
            <span {...stylex.props(styles.eyebrow)}>{labels.paymentTerms}</span>
            <p>{terms}</p>
          </div>
        ) : null}
      </article>
    </div>
  );
}

export function InvoiceProgress({
  title,
  items,
  note,
}: {
  title: string;
  items: { label: string; value: string }[];
  note: string;
}) {
  return (
    <section {...stylex.props(statusStyles.section)} aria-label={title}>
      <h3 {...stylex.props(statusStyles.heading)}>{title}</h3>
      <dl {...stylex.props(statusStyles.grid)}>
        {items.map((item) => (
          <div key={item.label} {...stylex.props(statusStyles.item)}>
            <dt {...stylex.props(statusStyles.label)}>{item.label}</dt>
            <dd {...stylex.props(statusStyles.value)}>{item.value}</dd>
          </div>
        ))}
      </dl>
      <p {...stylex.props(statusStyles.note)}>{note}</p>
    </section>
  );
}

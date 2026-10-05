import { Fragment, type ReactNode, type ComponentProps } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@open-erp/ui/components/link";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  facts: { margin: 0 },
  fact: {
    display: "flex",
    alignItems: "center",
    minHeight: 32,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    ":first-child": {
      borderBlockStartWidth: 1,
      borderBlockStartStyle: "solid",
      borderBlockStartColor: tokens.border,
    },
  },
  label: { width: 240, flexShrink: 0, color: tokens.captionForeground },
  value: { margin: 0, flexGrow: 1 },
  rowAction: { color: tokens.primary },
  action: { flexShrink: 0, marginInlineStart: 12 },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  header: {
    height: 28,
    backgroundColor: tokens.sidebar,
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeXs,
    borderBlockWidth: 1,
    borderBlockStyle: "solid",
    borderBlockColor: tokens.border,
  },
  heading: {
    height: 26,
    color: tokens.captionForeground,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
  },
  row: {
    height: 30,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.rowDivider,
  },
  text: { paddingInlineStart: 8, textAlign: "left", fontWeight: "inherit" },
  number: {
    width: 120,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    fontWeight: "inherit",
  },
  credit: { paddingInlineEnd: 8 },
});

export function ProcessorFacts({
  rows,
}: {
  rows: readonly { label: string; value: ReactNode; action?: ReactNode }[];
}) {
  return (
    <dl {...stylex.props(styles.facts)}>
      {rows.map((row) => (
        <div key={row.label} {...stylex.props(styles.fact)}>
          <dt {...stylex.props(styles.label)}>{row.label}</dt>
          <dd {...stylex.props(styles.value)}>{row.value}</dd>
          {row.action ? <span {...stylex.props(styles.action)}>{row.action}</span> : null}
        </div>
      ))}
    </dl>
  );
}

export function ProcessorJournal({
  groups,
}: {
  groups: readonly {
    label: ReactNode;
    id: string;
    rows: readonly {
      id: string;
      label: string;
      debit: string;
      credit: string;
    }[];
  }[];
}) {
  return (
    <table aria-label="Utbetalningens två steg" {...stylex.props(styles.table)}>
      <thead>
        <tr {...stylex.props(styles.header)}>
          <th scope="col" {...stylex.props(styles.text)}>
            Konto
          </th>
          <th scope="col" {...stylex.props(styles.number)}>
            Debet
          </th>
          <th scope="col" {...stylex.props(styles.number, styles.credit)}>
            Kredit
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <Fragment key={group.id}>
            <tr {...stylex.props(styles.heading)}>
              <th scope="rowgroup" colSpan={3} {...stylex.props(styles.text)}>
                {group.label}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.id} {...stylex.props(styles.row)}>
                <td {...stylex.props(styles.text)}>{row.label}</td>
                <td {...stylex.props(styles.number)}>{row.debit}</td>
                <td {...stylex.props(styles.number, styles.credit)}>{row.credit}</td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export function ProcessorRowAction(props: ComponentProps<"a">) {
  return <Link {...props} {...stylex.props(styles.rowAction)} />;
}

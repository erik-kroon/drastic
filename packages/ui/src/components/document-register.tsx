import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@open-erp/ui/components/link";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  scroll: { overflowX: "auto", minWidth: 0 },
  table: {
    width: "100%",
    minWidth: 640,
    borderCollapse: "collapse",
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
  },
  header: { backgroundColor: tokens.sidebar, color: tokens.mutedForeground },
  heading: {
    height: 30,
    textAlign: "start",
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightSemibold,
    paddingBlock: tokens.space1,
  },
  cell: {
    height: 40,
    paddingBlock: tokens.space0,
    textAlign: "start",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    verticalAlign: "middle",
  },
  first: { paddingInlineStart: tokens.space5 },
  type: { width: 150, color: tokens.mutedForeground },
  source: { width: 130, color: tokens.mutedForeground },
  date: {
    width: 100,
    textAlign: "end",
    paddingInlineEnd: tokens.space5,
    color: tokens.mutedForeground,
  },
  selected: { backgroundColor: tokens.registerSelected, boxShadow: tokens.selectionIndicator },
  row: {
    ":hover": { backgroundColor: tokens.sidebar },
    ":focus-within": { backgroundColor: tokens.registerSelected },
  },
  link: {
    width: "100%",
    backgroundColor: tokens.transparent,
    borderWidth: 0,
    padding: 0,
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    minHeight: 39,
    color: tokens.foreground,
    textDecoration: "none",
    overflowWrap: "anywhere",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRingInset },
  },
});

export function DocumentRegister(props: {
  title: string;
  headings: { document: string; facts?: string; type: string; source: string; date: string };
  rows: readonly {
    id: string;
    filename: string;
    facts?: ReactNode;
    type: string;
    source: string;
    date: string;
    href: string;
  }[];
  onOpen: (id: string) => void;
  onSelect?: (id: string) => void;
  selected?: string;
}) {
  return (
    <div {...stylex.props(styles.scroll)}>
      <table aria-label={props.title} {...stylex.props(styles.table)}>
        <thead {...stylex.props(styles.header)}>
          <tr>
            <th scope="col" {...stylex.props(styles.cell, styles.heading, styles.first)}>
              {props.headings.document}
            </th>
            {props.headings.facts ? (
              <th scope="col" {...stylex.props(styles.cell, styles.heading)}>
                {props.headings.facts}
              </th>
            ) : null}
            <th scope="col" {...stylex.props(styles.cell, styles.heading, styles.type)}>
              {props.headings.type}
            </th>
            <th scope="col" {...stylex.props(styles.cell, styles.heading, styles.source)}>
              {props.headings.source}
            </th>
            <th scope="col" {...stylex.props(styles.cell, styles.heading, styles.date)}>
              {props.headings.date}
            </th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr
              key={row.id}
              {...stylex.props(styles.row, props.selected === row.id && styles.selected)}
            >
              <td {...stylex.props(styles.cell, styles.first)}>
                {props.onSelect ? (
                  <button
                    type="button"
                    data-document-id={row.id}
                    aria-pressed={props.selected === row.id}
                    onClick={() => props.onSelect?.(row.id)}
                    {...stylex.props(styles.link)}
                  >
                    {row.filename}
                  </button>
                ) : (
                  <Link
                    href={row.href}
                    data-document-id={row.id}
                    onClick={() => props.onOpen(row.id)}
                    {...stylex.props(styles.link)}
                  >
                    {row.filename}
                  </Link>
                )}
              </td>
              {props.headings.facts ? <td {...stylex.props(styles.cell)}>{row.facts}</td> : null}
              <td {...stylex.props(styles.cell, styles.type)}>{row.type}</td>
              <td {...stylex.props(styles.cell, styles.source)}>{row.source}</td>
              <td {...stylex.props(styles.cell, styles.date)}>{row.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

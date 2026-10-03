import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  layout: {
    display: "grid",
    gridTemplateColumns: {
      default: "720px minmax(0, 1fr)",
      "@container (max-width: 75rem)": "minmax(0, 1fr)",
    },
    minWidth: 0,
    minHeight: "calc(100dvh - 48px)",
  },
  fields: {
    paddingBlock: tokens.space7,
    paddingInline: { default: tokens.space10, "@container (max-width: 45rem)": tokens.space4 },
    display: "grid",
    gap: tokens.space5,
    alignContent: "start",
    minWidth: 0,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: tokens.border,
  },
  preview: {
    backgroundColor: tokens.reviewCanvas,
    padding: { default: tokens.space8, "@container (max-width: 45rem)": tokens.space4 },
    minWidth: 0,
  },
  document: { maxWidth: 520, marginInline: "auto", minWidth: 0 },
});

export function InvoiceEditorLayout({
  children,
  preview,
}: {
  children: ReactNode;
  preview: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.layout)}>
      <section {...stylex.props(styles.fields)}>{children}</section>
      <aside {...stylex.props(styles.preview)}>
        <div {...stylex.props(styles.document)}>{preview}</div>
      </aside>
    </div>
  );
}

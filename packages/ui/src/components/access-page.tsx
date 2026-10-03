import type { ComponentProps, ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@open-erp/ui/components/button";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  page: {
    minHeight: "100dvh",
    display: "grid",
    placeItems: "center",
    backgroundColor: tokens.sidebar,
    padding: tokens.space4,
  },
  card: {
    width: "360px",
    maxWidth: "100%",
    padding: tokens.space8,
    backgroundColor: tokens.card,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusSurface,
  },
  mark: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    backgroundColor: tokens.foreground,
    color: tokens.primaryForeground,
    borderRadius: tokens.radiusControl,
    fontSize: tokens.fontSizeCompact,
    fontWeight: tokens.fontWeightBold,
    lineHeight: tokens.lineHeight16Px,
    marginBlockEnd: tokens.space4_5,
  },
  form: { display: "grid", gap: tokens.space3 },
  title: {
    fontSize: tokens.fontSizeLg,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight22Px,
    marginBlockEnd: tokens.space2,
  },
  submit: {
    width: "100%",
    minHeight: 32,
    fontSize: tokens.fontSizeControl,
    boxShadow: tokens.shadowNone,
    marginBlockStart: tokens.space1_5,
  },
});

export function AccessPage({ children }: { children: ReactNode }) {
  return (
    <main {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.card)}>
        <span aria-label="OpenERP" {...stylex.props(styles.mark)}>
          OE
        </span>
        {children}
      </section>
    </main>
  );
}

export function AccessForm({
  title,
  children,
  ...props
}: Omit<ComponentProps<"form">, "style" | "className"> & { title: string }) {
  return (
    <form {...props} {...stylex.props(styles.form)}>
      <h1 {...stylex.props(styles.title)}>{title}</h1>
      {children}
    </form>
  );
}

export function AccessSubmit(props: Omit<ComponentProps<typeof Button>, "styleX" | "size">) {
  return <Button {...props} type="submit" styleX={styles.submit} />;
}

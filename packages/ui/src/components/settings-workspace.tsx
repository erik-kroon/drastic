import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@open-erp/ui/components/link";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  workspace: {
    display: "grid",
    gridTemplateColumns: "200px minmax(0, 1fr)",
    minHeight: "100dvh",
    marginInline: tokens.spaceNegative5,
    marginBlockStart: tokens.spaceNegative4,
    marginBlockEnd: tokens.spaceNegative8,
    "@container (max-width: 45rem)": { gridTemplateColumns: "minmax(0, 1fr)" },
    "@media (max-width: 767px)": { marginInline: tokens.spaceNegative4 },
  },
  navigation: {
    paddingInline: tokens.space3,
    paddingBlock: tokens.space4,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: tokens.border,
    "@container (max-width: 45rem)": {
      borderInlineEndWidth: 0,
      borderBlockEndWidth: 1,
      borderBlockEndStyle: "solid",
      borderBlockEndColor: tokens.border,
    },
  },
  title: {
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight20Px,
    paddingInline: tokens.space2_5,
    marginBlockEnd: tokens.space5,
  },
  links: {
    display: "grid",
    gap: 2,
    "@container (max-width: 45rem)": { display: "flex", flexWrap: "wrap" },
  },
  link: {
    display: "flex",
    alignItems: "center",
    minHeight: 28,
    paddingInline: tokens.space2_5,
    paddingBlock: tokens.space1,
    borderRadius: tokens.radiusControl,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.mutedForeground,
    textDecoration: "none",
    backgroundColor: { default: tokens.transparent, ":hover": tokens.sidebar },
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
    "@media (pointer: coarse)": { minHeight: 44 },
  },
  active: {
    backgroundColor: { default: tokens.registerSelected, ":hover": tokens.registerSelected },
    color: tokens.foreground,
    fontWeight: tokens.fontWeightMedium,
    boxShadow: tokens.selectionIndicator,
  },
  main: { minWidth: 0 },
  heading: {
    display: "flex",
    alignItems: "center",
    minHeight: 48,
    paddingInline: tokens.space6,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    fontSize: tokens.fontSizeSm,
    fontWeight: tokens.fontWeightSemibold,
  },
  content: {
    display: "grid",
    gap: tokens.space6,
    padding: tokens.space6,
    maxWidth: 800,
    minWidth: 0,
  },
});

export function SettingsWorkspace(props: {
  title: string;
  section: string;
  navigationLabel: string;
  items: readonly { label: string; href: string; active: boolean }[];
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.workspace)}>
      <nav aria-label={props.navigationLabel} {...stylex.props(styles.navigation)}>
        <h1 {...stylex.props(styles.title)}>{props.title}</h1>
        <div {...stylex.props(styles.links)}>
          {props.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              {...stylex.props(styles.link, item.active && styles.active)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
      <section {...stylex.props(styles.main)}>
        <h2 {...stylex.props(styles.heading)}>{props.section}</h2>
        <div {...stylex.props(styles.content)}>{props.children}</div>
      </section>
    </div>
  );
}

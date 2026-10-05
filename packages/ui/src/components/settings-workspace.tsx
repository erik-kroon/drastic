import type { ComponentProps, ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@open-erp/ui/components/link";
import { Heading } from "@open-erp/ui/components/typography";
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
    borderRadius: tokens.radiusSmallControl,
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
  },
  content: {
    display: "grid",
    gap: tokens.space6,
    padding: tokens.space6,
    maxWidth: 800,
    minWidth: 0,
  },
});

export function SettingsNavigationItem({
  active = false,
  ...props
}: Omit<ComponentProps<typeof Link>, "className" | "style"> & { active?: boolean }) {
  return (
    <Link
      {...props}
      aria-current={active ? "page" : undefined}
      {...stylex.props(styles.link, active && styles.active)}
    />
  );
}

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
        <Heading level={1} size="page" styleX={styles.title}>
          {props.title}
        </Heading>
        <div {...stylex.props(styles.links)}>
          {props.items.map((item) => (
            <SettingsNavigationItem key={item.href} href={item.href} active={item.active}>
              {item.label}
            </SettingsNavigationItem>
          ))}
        </div>
      </nav>
      <section {...stylex.props(styles.main)}>
        <Heading size="section" styleX={styles.heading}>
          {props.section}
        </Heading>
        <div {...stylex.props(styles.content)}>{props.children}</div>
      </section>
    </div>
  );
}

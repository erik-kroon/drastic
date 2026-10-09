import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@open-erp/ui/components/link";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  page: { minHeight: "100dvh", backgroundColor: tokens.card },
  header: {
    height: 48,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: tokens.space5,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: tokens.border,
    fontSize: tokens.fontSizeSm,
  },
  content: {
    width: 480,
    maxWidth: "100%",
    marginInline: "auto",
    paddingBlockStart: tokens.space20,
    paddingBlockEnd: tokens.space8,
    "@media (max-width: 767px)": { paddingInline: tokens.space4, paddingBlockStart: tokens.space8 },
  },
  heading: {
    fontSize: tokens.fontSizeLg,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight22Px,
    marginBlockEnd: tokens.space1,
  },
  subtitle: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    marginBlockEnd: tokens.space4_5,
  },
  list: { display: "grid", gap: tokens.space2 },
  choice: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space3,
    minHeight: 56,
    paddingInline: tokens.space3_5,
    paddingBlock: tokens.space2,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.input,
    borderRadius: tokens.radiusSurface,
    color: tokens.foreground,
    textDecoration: "none",
    ":hover": { backgroundColor: tokens.registerSelected },
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  mark: {
    width: 28,
    height: 28,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    backgroundColor: tokens.foreground,
    color: tokens.primaryForeground,
    fontSize: tokens.fontSizeCompact,
    fontWeight: tokens.fontWeightBold,
    borderRadius: tokens.radiusControl,
  },
  identity: { flex: "1", minWidth: 0, display: "grid" },
  name: {
    fontSize: tokens.fontSizeControl,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeight16Px,
  },
  detail: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
  },
  action: { color: tokens.primary, fontSize: tokens.fontSizeControl, flexShrink: 0 },
  footer: { display: "grid", gap: tokens.space4, marginBlockStart: tokens.space4_5 },
});

export function CompanyChooser({
  title,
  subtitle,
  headerActions,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  headerActions: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <strong>Drastic</strong>
        {headerActions}
      </header>
      <section {...stylex.props(styles.content)}>
        <h1 {...stylex.props(styles.heading)}>{title}</h1>
        <p {...stylex.props(styles.subtitle)}>{subtitle}</p>
        <div {...stylex.props(styles.list)}>{children}</div>
        <div {...stylex.props(styles.footer)}>{footer}</div>
      </section>
    </main>
  );
}

export function CompanyChoice({
  name,
  detail,
  href,
  openLabel,
}: {
  name: string;
  detail: string;
  href: string;
  openLabel: string;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase();

  return (
    <Link href={href} {...stylex.props(styles.choice)}>
      <span aria-hidden="true" {...stylex.props(styles.mark)}>
        {initials}
      </span>
      <span {...stylex.props(styles.identity)}>
        <span {...stylex.props(styles.name)}>{name}</span>
        <span {...stylex.props(styles.detail)}>{detail}</span>
      </span>
      <span {...stylex.props(styles.action)}>{openLabel}</span>
    </Link>
  );
}

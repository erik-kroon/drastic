import { Dialog } from "@base-ui/react/dialog";
import { useState, useRef, useLayoutEffect, type ComponentProps, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@open-erp/ui/components/link";
import { kanon } from "@open-erp/ui/theme/kanon.stylex";

const styles = stylex.create({
  shell: {
    display: "grid",
    gridTemplateColumns: {
      default: `${kanon.sizeSidebar} minmax(0, 1fr)`,
      "@media (max-width: 767px)": "minmax(0, 1fr)",
    },
    backgroundColor: kanon.colorSideSurface,
    minHeight: "100dvh",
  },
  focusedShell: { gridTemplateColumns: "minmax(0, 1fr)" },
  focusedContent: { paddingInline: 0, paddingBlockStart: 0, paddingBlockEnd: 0 },
  fullPageContent: {
    display: "flex",
    flexDirection: "column",
    height: { default: "100%", "@media (max-width: 767px)": "auto" },
    paddingInline: 0,
    paddingBlockStart: 0,
    paddingBlockEnd: {
      default: 0,
      "@media (max-width: 767px)": "calc(88px + env(safe-area-inset-bottom))",
    },
  },
  sidebar: {
    display: { default: "flex", "@media (max-width: 767px)": "none" },
    flexDirection: "column",
    gap: 1,
    height: "100dvh",
    insetBlockStart: 0,
    overflowY: "auto",
    paddingInline: kanon.space2,
    paddingBlock: kanon.space25,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: kanon.colorRule,
    position: "sticky",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: kanon.space2,
    paddingInline: kanon.space2,
    height: 32,
    marginBlockEnd: kanon.space15,
  },
  companyMark: {
    display: "grid",
    placeItems: "center",
    width: 20,
    height: 20,
    flexShrink: 0,
    borderRadius: kanon.radiusCompanyMark,
    backgroundColor: kanon.colorText,
    color: kanon.colorSurface,
    fontSize: kanon.textCompact,
    fontWeight: kanon.weightSemibold,
    lineHeight: kanon.leadingCompact,
  },
  companyLink: {
    color: kanon.colorText,
    textDecoration: "none",
    ":focus-visible": { outline: "none", boxShadow: kanon.shadowFocus },
  },
  brandName: {
    fontSize: kanon.textBody,
    fontWeight: kanon.weightSemibold,
    lineHeight: kanon.leadingBody,
  },
  brandDetail: { color: kanon.colorSecondary, fontSize: kanon.textCaption },
  navGroup: { marginBlockEnd: 0 },
  navigation: { display: "grid", gap: 1 },
  navigationLabel: {
    color: kanon.colorSecondary,
    fontSize: kanon.textCompact,
    fontWeight: kanon.weightSemibold,
    lineHeight: kanon.leadingCompact,
    textTransform: "uppercase",
    paddingInline: kanon.space2,
    paddingBlockStart: kanon.space3,
    paddingBlockEnd: kanon.space1,
    marginBlockEnd: 1,
  },
  navItem: {
    color: { default: kanon.colorSecondary, ":hover": kanon.colorText },
    fontSize: kanon.textBody,
    justifyContent: "start",
    minHeight: 28,
    lineHeight: kanon.leadingBody,
    paddingInline: kanon.space2,
    whiteSpace: "normal",
    textAlign: "start",
    width: "100%",
    "@media (pointer: coarse)": { minHeight: 44 },
    "@media (max-width: 767px)": { minHeight: 44 },
  },
  navLink: {
    alignItems: "center",
    borderRadius: kanon.radiusControl,
    display: "flex",
    gap: kanon.space2,
    paddingBlock: kanon.space15,
    textDecoration: "none",
    backgroundColor: { default: "transparent", ":hover": kanon.colorRule },
    transitionProperty: "background-color, color",
    transitionDuration: kanon.durationQuick,
    ":focus-visible": { outline: "none", boxShadow: kanon.shadowFocus },
  },
  navActive: {
    backgroundColor: { default: kanon.colorRule, ":hover": kanon.colorRule },
    color: { default: kanon.colorSecondary, ":hover": kanon.colorText },
  },
  navCount: {
    marginInlineStart: "auto",
    color: kanon.colorSecondary,
    fontSize: kanon.textCaption,
    lineHeight: kanon.leadingBody,
    fontVariantNumeric: "tabular-nums",
  },
  companyChevron: {
    color: kanon.colorSecondary,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textCaption,
    lineHeight: kanon.leadingBody,
    marginInlineStart: "auto",
  },
  avatar: {
    display: "grid",
    placeItems: "center",
    width: kanon.sizeAvatar,
    height: kanon.sizeAvatar,
    flexShrink: 0,
    borderRadius: kanon.radiusPill,
    backgroundColor: kanon.colorAvatar,
    color: kanon.colorAction,
    fontSize: kanon.textMicro,
    fontWeight: kanon.weightSemibold,
    lineHeight: kanon.leadingMicro,
  },
  navSub: {
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: kanon.colorRule,
    paddingInlineStart: 6,
    marginInlineStart: 19,
    marginBlock: 4,
    display: "grid",
    gap: 1,
  },
  footer: {
    display: "grid",
    gap: 1,
    marginBlockStart: "auto",
    paddingBlockStart: kanon.space4,
  },
  body: {
    minWidth: 0,
    backgroundColor: kanon.colorSurface,
    borderRadius: 0,
    height: "100dvh",
    overflowY: "auto",
    containerType: "inline-size",
    "@media (max-width: 767px)": {
      height: "auto",
      minHeight: "100dvh",
      borderWidth: 0,
      borderRadius: 0,
      margin: 0,
      overflowY: "visible",
    },
  },
  content: {
    minWidth: 0,
    paddingInline: { default: 20, "@media (max-width: 767px)": 16 },
    paddingBlockStart: 16,
    paddingBlockEnd: 32,
    "@media (max-width: 767px)": { paddingBlockEnd: "calc(88px + env(safe-area-inset-bottom))" },
  },
  mobileBar: {
    display: { default: "none", "@media (max-width: 767px)": "flex" },
    alignItems: "stretch",
    position: "fixed",
    insetBlockEnd: 0,
    insetInline: 0,
    zIndex: 30,
    backgroundColor: kanon.colorSurface,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: kanon.colorRule,
    paddingBlockEnd: "env(safe-area-inset-bottom)",
    minHeight: 64,
  },
  mobileLink: {
    display: "flex",
    flexGrow: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: 64,
    fontSize: kanon.textCompact,
    color: kanon.colorSecondary,
    textDecoration: "none",
    backgroundColor: "transparent",
    borderWidth: 0,
    cursor: "pointer",
    ":focus-visible": { outline: "none", boxShadow: kanon.shadowFocus },
  },
  mobileActive: { color: kanon.colorText, fontWeight: kanon.weightSemibold },
  backdrop: { position: "fixed", inset: 0, backgroundColor: kanon.colorScrim, zIndex: 40 },
  dialog: {
    position: "fixed",
    insetBlockEnd: 0,
    insetInline: 0,
    zIndex: 45,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: kanon.colorRule,
    borderStartStartRadius: kanon.radiusOverlay,
    borderStartEndRadius: kanon.radiusOverlay,
    backgroundColor: kanon.colorSurface,
    color: kanon.colorText,
    padding: 16,
    margin: 0,
    marginBlockStart: "auto",
    width: "100%",
    maxWidth: "none",
    maxHeight: "85dvh",
    overflowY: "auto",
    paddingBlockEnd: "max(16px, env(safe-area-inset-bottom))",
    "::backdrop": { backgroundColor: kanon.colorScrim },
  },
  dialogHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBlockEnd: 16,
  },
  account: { position: "relative", fontSize: kanon.textBody, minWidth: 0 },
  accountSummary: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    listStyle: "none",
    borderRadius: kanon.radiusCard,
    paddingInline: kanon.space2,
    paddingBlock: kanon.space1,
    minHeight: 32,
    lineHeight: kanon.leadingBody,
    cursor: "pointer",
    ":hover": { backgroundColor: kanon.colorRule },
    ":focus-visible": { outline: "none", boxShadow: kanon.shadowFocus },
  },
  accountDetails: {
    position: "absolute",
    insetBlockEnd: "100%",
    insetInline: 0,
    zIndex: 20,
    maxHeight: "70dvh",
    overflowY: "auto",
    boxShadow: kanon.shadowOverlay,
    display: "grid",
    gap: 12,
    padding: 12,
    marginBlockEnd: 8,
    backgroundColor: kanon.colorSurface,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: kanon.colorRule,
    borderRadius: kanon.radiusCard,
  },
  accountName: {
    flexGrow: 1,
    minWidth: 0,
    overflowWrap: "anywhere",
    fontWeight: kanon.weightMedium,
  },

  mobileClose: {
    display: "grid",
    placeItems: "center",
    width: kanon.sizeButtonPrimary,
    height: kanon.sizeButtonPrimary,
    borderWidth: 0,
    borderRadius: kanon.radiusControl,
    backgroundColor: { default: "transparent", ":hover": kanon.colorRule },
    color: kanon.colorSecondary,
    cursor: "pointer",
    ":focus-visible": { outline: "none", boxShadow: kanon.shadowFocus },
  },
});

/** Frame and navigation adapted from Accounted UI v2. See licenses/accounted-LICENSE. */
export function Workspace(props: {
  brand: ReactNode;
  navigation: ReactNode;
  footer: ReactNode;
  mobileNavigation: ReactNode;
  pageKey: string;
  children: ReactNode;
  focused?: boolean;
  contentInset?: "page" | "none";
}) {
  const main = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [props.pageKey]);

  return (
    <div {...stylex.props(styles.shell, props.focused && styles.focusedShell)}>
      {!props.focused ? (
        <aside {...stylex.props(styles.sidebar)}>
          {props.brand}
          {props.navigation}
          <div {...stylex.props(styles.footer)}>{props.footer}</div>
        </aside>
      ) : null}
      <main ref={main} id="workspace-content" {...stylex.props(styles.body)}>
        <div
          {...stylex.props(
            styles.content,
            props.contentInset === "none" && styles.fullPageContent,
            props.focused && styles.focusedContent,
          )}
        >
          {props.children}
        </div>
      </main>
      {!props.focused ? props.mobileNavigation : null}
    </div>
  );
}

export function WorkspaceAccount({
  name,
  detail,
  children,
}: {
  name: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <details {...stylex.props(styles.account)}>
      <summary {...stylex.props(styles.accountSummary)}>
        <span aria-hidden="true" {...stylex.props(styles.avatar)}>
          {initialsOf(name)}
        </span>
        <span {...stylex.props(styles.accountName)}>
          {name}
          {detail ? (
            <span {...stylex.props(styles.brandDetail)}>
              <br />
              {detail}
            </span>
          ) : null}
        </span>
      </summary>
      <div {...stylex.props(styles.accountDetails)}>{children}</div>
    </details>
  );
}

export function WorkspaceSubnavigation({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.navSub)}>{children}</div>;
}

export function WorkspaceMobileNavigation(props: {
  label: string;
  closeLabel: string;
  items: { label: string; href: string; icon: ReactNode; active: boolean }[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <nav aria-label={props.label} {...stylex.props(styles.mobileBar)}>
        {props.items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            {...stylex.props(styles.mobileLink, item.active && styles.mobileActive)}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
        <Dialog.Trigger {...stylex.props(styles.mobileLink)}>
          <Menu size={20} strokeWidth={1.5} aria-hidden="true" />
          {props.label}
        </Dialog.Trigger>
      </nav>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup {...stylex.props(styles.dialog)}>
          <div {...stylex.props(styles.dialogHeader)}>
            <Dialog.Title>{props.label}</Dialog.Title>
            <Dialog.Close aria-label={props.closeLabel} {...stylex.props(styles.mobileClose)}>
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
            }}
          >
            {props.children}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function WorkspaceBrand({
  icon,
  name,
  detail,
}: {
  icon: ReactNode;
  name: string;
  detail?: string;
}) {
  return (
    <div {...stylex.props(styles.brand)}>
      {icon}
      <div>
        <p {...stylex.props(styles.brandName)}>{name}</p>
        {detail ? <p {...stylex.props(styles.brandDetail)}>{detail}</p> : null}
      </div>
    </div>
  );
}

function initialsOf(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase();
}

export function WorkspaceCompany({ name, href }: { name: string; href: string }) {
  const initials = initialsOf(name);

  return (
    <Link href={href} {...stylex.props(styles.brand, styles.companyLink)}>
      <span aria-hidden="true" {...stylex.props(styles.companyMark)}>
        {initials}
      </span>
      <span {...stylex.props(styles.brandName)}>{name}</span>
      <span aria-hidden="true" {...stylex.props(styles.companyChevron)}>
        ⌄
      </span>
    </Link>
  );
}

export function WorkspaceNavigation({
  label,
  children,
  showLabel = true,
}: {
  label: string;
  children: ReactNode;
  showLabel?: boolean;
}) {
  return (
    <nav aria-label={label} {...stylex.props(styles.navGroup)}>
      {showLabel ? <p {...stylex.props(styles.navigationLabel)}>{label}</p> : null}
      <div {...stylex.props(styles.navigation)}>{children}</div>
    </nav>
  );
}

export function WorkspaceNavLink(
  props: Pick<
    ComponentProps<typeof Link>,
    "href" | "onFocus" | "onPointerEnter" | "children" | "aria-label"
  > & {
    active?: boolean;
    current?: boolean;
    count?: number | string;
  },
) {
  const current = props.current ?? props.active;

  return (
    <Link
      href={props.href}
      onFocus={props.onFocus}
      onPointerEnter={props.onPointerEnter}
      aria-label={props["aria-label"]}
      aria-current={current ? "page" : undefined}
      {...stylex.props(styles.navItem, styles.navLink, props.active && styles.navActive)}
    >
      {props.children}
      {props.count && props.count !== "0" ? (
        <span {...stylex.props(styles.navCount)}>{props.count}</span>
      ) : null}
    </Link>
  );
}

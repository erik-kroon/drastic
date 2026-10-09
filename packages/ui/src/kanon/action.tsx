import { Button as ButtonPrimitive } from "@base-ui/react/button";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps, ReactNode } from "react";

import { kanon } from "@open-erp/ui/theme/kanon.stylex";

/**
 * primary: the one action per view, named after its effect ("Godkänn och bokför 12 500,00").
 * secondary: alternatives that change something. quiet: alternatives that change nothing.
 * risky: outlined red, opens a confirmation. confirmRisky: solid red, only inside that dialog.
 */
export type ActionKind = "primary" | "secondary" | "quiet" | "risky" | "confirmRisky";

const styles = stylex.create({
  root: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: kanon.radiusControl,
    borderStyle: "solid",
    borderWidth: 1,
    cursor: "pointer",
    display: "inline-flex",
    flexShrink: 0,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textBody,
    gap: kanon.space2,
    justifyContent: "center",
    lineHeight: kanon.leadingBody,
    outline: "none",
    paddingInline: kanon.space4,
    transitionDuration: kanon.durationQuick,
    transitionProperty: "background-color, border-color, box-shadow",
    transitionTimingFunction: kanon.easeOut,
    userSelect: "none",
    whiteSpace: "nowrap",
    ":focus-visible": { boxShadow: kanon.shadowFocus, borderColor: kanon.colorAction },
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },
  tall: { height: kanon.sizeButtonPrimary },
  regular: { height: kanon.sizeButton },
  compact: { height: kanon.sizeButtonSmall, paddingInline: kanon.space3 },
  fill: { width: "100%" },
  primary: {
    backgroundColor: { default: kanon.colorAction, ":hover": kanon.colorActionHover },
    boxShadow: kanon.shadowPrimary,
    color: kanon.colorOnAction,
    fontWeight: kanon.weightSemibold,
  },
  secondary: {
    backgroundColor: { default: kanon.colorSurface, ":hover": kanon.colorSideSurface },
    borderColor: kanon.colorControl,
    color: kanon.colorText,
  },
  quiet: {
    backgroundColor: { default: "transparent", ":hover": kanon.colorSideSurface },
    color: kanon.colorSecondary,
  },
  risky: {
    backgroundColor: { default: kanon.colorSurface, ":hover": kanon.colorBlockedBackground },
    borderColor: kanon.colorRiskyBorder,
    color: kanon.colorError,
  },
  confirmRisky: {
    backgroundColor: kanon.colorError,
    color: kanon.colorOnAction,
    fontWeight: kanon.weightSemibold,
  },
  blocked: {
    backgroundColor: kanon.colorRule,
    borderColor: "transparent",
    boxShadow: "none",
    color: kanon.colorCaption,
    cursor: "not-allowed",
    fontWeight: kanon.weightSemibold,
  },
});

const kindStyle = {
  primary: styles.primary,
  secondary: styles.secondary,
  quiet: styles.quiet,
  risky: styles.risky,
  confirmRisky: styles.confirmRisky,
} as const;

type ActionProps = {
  kind: ActionKind;
  children: ReactNode;
  onClick?: () => void;
  /** Use "submit" only inside a form. */
  type?: "button" | "submit";
  /** Render as a router link: render={<Link to="..." />}. */
  render?: ComponentProps<typeof ButtonPrimitive>["render"];
  /** Set when the action cannot run. The reason replaces the label: "Välj kund för att skicka". */
  blockedBy?: string;
  /** Top bars, list rows and file rows use the 28 px size. */
  compact?: boolean;
  /** In a footer row beside the primary, as in dialogs and drawers: match its 36 px height. */
  besidePrimary?: boolean;
  /** Stretch to the container, as in the detail panel's action area. */
  fill?: boolean;
};

export function Action(props: ActionProps) {
  const { kind, blockedBy, compact } = props;
  const prominent = kind === "primary" || kind === "confirmRisky" || props.besidePrimary === true;
  const height = compact === true ? styles.compact : prominent ? styles.tall : styles.regular;

  return (
    <ButtonPrimitive
      type={props.type ?? "button"}
      onClick={props.onClick}
      render={props.render}
      nativeButton={props.render === undefined}
      disabled={blockedBy !== undefined}
      focusableWhenDisabled={blockedBy !== undefined}
      {...stylex.props(
        styles.root,
        height,
        kindStyle[kind],
        blockedBy !== undefined && styles.blocked,
        props.fill === true && styles.fill,
      )}
    >
      {blockedBy ?? props.children}
    </ButtonPrimitive>
  );
}

const inlineStyles = stylex.create({
  inline: {
    backgroundColor: "transparent",
    borderWidth: 0,
    color: { default: kanon.colorAction, ":hover": kanon.colorActionHover },
    cursor: "pointer",
    fontFamily: kanon.fontUi,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
    padding: 0,
    textDecoration: "none",
  },
});

/** Blue text that opens or navigates, never changes data: "Öppna", "Välj annat underlag". */
export function InlineAction(props: {
  children: ReactNode;
  onClick?: () => void;
  render?: ComponentProps<typeof ButtonPrimitive>["render"];
}) {
  return (
    <ButtonPrimitive
      type="button"
      onClick={props.onClick}
      render={props.render}
      nativeButton={props.render === undefined}
      {...stylex.props(inlineStyles.inline)}
    >
      {props.children}
    </ButtonPrimitive>
  );
}

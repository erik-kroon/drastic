import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { stylexProps, stateStylexProps, type WithStyleX } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";

import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import * as React from "react";

type ButtonVariant =
  | "default"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive"
  | "link"
  | "unstyled";
type ButtonSize =
  | "default"
  | "xs"
  | "sm"
  | "lg"
  | "xl"
  | "icon"
  | "icon-xs"
  | "icon-sm"
  | "icon-lg";

const styles = stylex.create({
  root: {
    alignItems: "center",
    backgroundClip: "padding-box",
    borderColor: "transparent",
    borderRadius: tokens.radiusControl,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: tokens.shadowXs,
    cursor: "pointer",
    display: "inline-flex",
    flexShrink: 0,
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightMedium,
    justifyContent: "center",
    outline: "none",
    position: "relative",
    transitionDuration: tokens.durationControl,
    transitionProperty: "color, background-color, border-color, box-shadow, scale",
    userSelect: "none",
    whiteSpace: "nowrap",
    ":focus-visible": {
      borderColor: tokens.ring,
      boxShadow: tokens.buttonFocusShadow,
    },
    "::after": {
      content: "''",
      inset: 0,
      position: "absolute",
      "@media (pointer: coarse)": { minHeight: "2.75rem", minWidth: "2.75rem" },
    },
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },
  pressable: {
    boxShadow: { default: tokens.shadowXs, ":active": "none" },
    scale: {
      default: 1,
      ":active": 0.96,
      "@media (prefers-reduced-motion: reduce)": 1,
    },
  },
  disabled: { cursor: "not-allowed", opacity: 0.5, pointerEvents: "none" },
  invalid: {
    borderColor: tokens.controlInvalidBorder,
    boxShadow: tokens.controlInvalidShadow,
  },
  defaultVariant: {
    backgroundColor: {
      default: tokens.primary,
      ":hover": tokens.primaryHoverBackground,
    },
    color: tokens.primaryForeground,
  },
  outline: {
    backgroundColor: {
      default: tokens.outlineBackground,
      ":hover": tokens.outlineHoverBackground,
      "[aria-expanded='true']": tokens.outlineHoverBackground,
    },
    borderColor: tokens.border,
    color: { default: tokens.foreground, ":hover": tokens.foreground },
  },
  secondary: {
    backgroundColor: {
      default: tokens.secondary,
      ":hover": tokens.secondaryHoverBackground,
    },
    color: tokens.secondaryForeground,
  },
  ghost: {
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.ghostHoverBackground,
      "[aria-expanded='true']": tokens.ghostHoverBackground,
    },
    boxShadow: "none",
    color: { default: tokens.foreground, ":hover": tokens.foreground },
  },
  destructive: {
    backgroundColor: {
      default: tokens.destructive,
      ":hover": tokens.destructiveSolidHoverBackground,
    },
    color: tokens.destructiveForeground,
    ":focus-visible": {
      borderColor: tokens.destructiveAlpha40,
      boxShadow: tokens.destructiveFocusShadow,
    },
  },
  link: {
    backgroundColor: "transparent",
    boxShadow: "none",
    color: tokens.primary,
  },
  defaultSize: {
    gap: tokens.space1_5,
    height: tokens.controlHeight,
    paddingInline: tokens.space2_5,
  },
  xs: { gap: tokens.space1, height: tokens.controlHeightXs, paddingInline: tokens.space2 },
  sm: { gap: tokens.space1, height: tokens.controlHeightSm, paddingInline: tokens.space2_5 },
  lg: { gap: tokens.space1_5, height: tokens.controlHeightLg, paddingInline: tokens.space2_5 },
  xl: {
    gap: tokens.space2,
    minHeight: tokens.space11,
    paddingInline: tokens.space4,
    fontSize: tokens.fontSizeSm,
  },
  icon: { height: tokens.controlHeight, width: tokens.controlHeight },
  iconXs: { height: tokens.controlHeightXs, width: tokens.controlHeightXs },
  iconSm: { height: tokens.controlHeightSm, width: tokens.controlHeightSm },
  iconLg: { height: tokens.controlHeightIconLg, width: tokens.controlHeightIconLg },
  arrow: {
    flexShrink: 0,
    height: "1em",
    transitionDuration: tokens.durationQuick,
    transitionProperty: "transform",
    width: "1em",
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },
});

const variantStyles = {
  default: styles.defaultVariant,
  outline: styles.outline,
  secondary: styles.secondary,
  ghost: styles.ghost,
  destructive: styles.destructive,
  link: styles.link,
  unstyled: undefined,
} as const;
const sizeStyles = {
  default: styles.defaultSize,
  xs: styles.xs,
  sm: styles.sm,
  lg: styles.lg,
  xl: styles.xl,
  icon: styles.icon,
  "icon-xs": styles.iconXs,
  "icon-sm": styles.iconSm,
  "icon-lg": styles.iconLg,
} as const;

type ButtonProps = WithStyleX<ButtonPrimitive.Props> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  withArrow?: boolean;
};

type ButtonArrowProps = React.ComponentProps<"svg">;

function ButtonArrow({ className, ...props }: ButtonArrowProps) {
  return (
    <svg
      aria-hidden="true"

      data-slot="button-arrow"
      fill="none"
      viewBox="0 0 16 16"
      {...stylexProps([styles.arrow], className)}
      {...props}
    >
      <path d="M3 8h9" stroke="currentColor" strokeLinecap="round" />
      <path d="m9 4 4 4-4 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function iconPixels(size: ButtonSize) {
  if (size === "xs" || size === "icon-xs") return 12;
  if (size === "sm") return 14;
  return 16;
}

function sizeIcon(child: React.ReactNode, size: ButtonSize) {
  if (!React.isValidElement<{ className?: string; style?: React.CSSProperties }>(child))
    return child;
  if (typeof child.type !== "object" || child.type === null) return child;
  const componentType: { displayName?: unknown } = child.type;
  if (typeof componentType.displayName !== "string") return child;

  const pixels = iconPixels(size);
  return React.cloneElement(child, {
    style: {
      ...child.props.style,
      flexShrink: 0,
      height: pixels,
      pointerEvents: "none",
      width: pixels,
    },
  });
}

function Button({
  children,
  className,
  variant = "default",
  size = "default",
  styleX,
  withArrow = false,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      {...stateStylexProps(
        (state) => [
          variant !== "unstyled" && styles.root,
          variant !== "unstyled" && props["aria-haspopup"] == null && styles.pressable,
          variantStyles[variant],
          variant !== "unstyled" && sizeStyles[size],
          state.disabled && styles.disabled,
          props["aria-invalid"] === true && styles.invalid,
          styleX,
        ],
        className,
      )}
      {...props}
    >
      {React.Children.map(children, (child) => sizeIcon(child, size))}
      {withArrow ? <ButtonArrow /> : null}
    </ButtonPrimitive>
  );
}

export { Button, ButtonArrow };
export type { ButtonArrowProps, ButtonProps, ButtonSize, ButtonVariant };

import { Input as InputPrimitive } from "@base-ui/react/input";
import { stylexProps, type WithStyleX } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  root: {
    backgroundColor: {
      default: tokens.controlBackground,
      ":disabled": tokens.controlDisabledBackground,
    },
    borderColor: {
      default: tokens.input,
      ":focus-visible": tokens.borderActive,
      "[aria-invalid='true']": tokens.controlInvalidBorder,
    },
    borderRadius: tokens.radiusControl,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: {
      default: tokens.shadowRaised,
      ":focus-visible": tokens.controlFocusShadow,
      "[aria-invalid='true']": tokens.controlInvalidShadow,
    },
    color: tokens.foreground,
    cursor: { default: "auto", ":disabled": "not-allowed" },
    fontSize: { default: tokens.fontSizeBase, "@media (min-width: 768px)": tokens.fontSizeXs },
    height: tokens.controlHeight,
    minWidth: 0,
    opacity: { default: 1, ":disabled": 0.5 },
    outline: "none",
    paddingBlock: tokens.space1,
    paddingInline: tokens.space2_5,
    transitionDuration: tokens.durationControl,
    transitionProperty: "border-color, box-shadow, background-color",
    transitionTimingFunction: tokens.easeDefault,
    width: "100%",
    "::placeholder": { color: tokens.mutedForeground },
    "::file-selector-button": {
      backgroundColor: "transparent",
      borderWidth: 0,
      color: tokens.foreground,
      display: "inline-flex",
      fontSize: tokens.fontSizeXs,
      fontWeight: tokens.fontWeightMedium,
      height: tokens.controlHeightXs,
    },
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },
});

type InputProps = WithStyleX<React.ComponentProps<"input">>;

function Input({ className, styleX, type, ...props }: InputProps) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      {...stylexProps([styles.root, styleX], className)}
      {...props}
    />
  );
}

export { Input };
export type { InputProps };

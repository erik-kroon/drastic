"use client";

import { tokens } from "@open-erp/ui/theme/tokens.stylex";

import { stylexProps, type StyleXStyles, type WithStyleX } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

const styles = stylex.create({
  root: {
    alignItems: "center",
    display: "flex",
    fontSize: tokens.fontSizeXs,
    gap: tokens.space2,
    lineHeight: tokens.lineHeightTight,
    userSelect: "none",
  },
  disabled: {
    cursor: "not-allowed",
    opacity: 0.5,
    pointerEvents: "none",
  },
});

type LabelProps = WithStyleX<React.ComponentProps<"label">> & {
  disabled?: boolean;
  unstyled?: boolean;
  styleX?: StyleXStyles;
};

function Label({ className, disabled, unstyled = false, styleX, ...props }: LabelProps) {
  return (
    <label
      data-slot="label"
      aria-disabled={disabled || undefined}
      {...stylexProps([!unstyled && styles.root, disabled && styles.disabled, styleX], className)}
      {...props}
    />
  );
}

export { Label };

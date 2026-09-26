import { stylexProps, type StyleXStyles, type WithStyleX } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";
import type * as React from "react";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  root: { alignItems: "center", display: "inline-flex", gap: tokens.space2 },
  dot: {
    borderRadius: tokens.radiusCircle,
    flexShrink: 0,
    height: "0.5rem",
    width: "0.5rem",
  },
  positive: { backgroundColor: tokens.successBorder },
  warning: { backgroundColor: tokens.warningBorder },
  negative: { backgroundColor: tokens.destructive },
  neutral: { backgroundColor: tokens.mutedForeground },
  label: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeightBodyCompact,
  },
});

type StatusIndicatorTone = "positive" | "warning" | "negative" | "neutral";

type StatusIndicatorProps = WithStyleX<React.ComponentProps<"span">> & {
  label: React.ReactNode;
  styleX?: StyleXStyles;
  tone?: StatusIndicatorTone;
};

const tones = {
  positive: styles.positive,
  warning: styles.warning,
  negative: styles.negative,
  neutral: styles.neutral,
} as const;

function StatusIndicator({
  className,
  label,
  styleX,
  tone = "neutral",
  ...props
}: StatusIndicatorProps) {
  return (
    <span
      data-slot="status-indicator"
      data-tone={tone}
      {...stylexProps([styles.root, styleX], className)}
      {...props}
    >
      <span aria-hidden="true" {...stylex.props(styles.dot, tones[tone])} />
      <span {...stylex.props(styles.label)}>{label}</span>
    </span>
  );
}

export { StatusIndicator };

export type { StatusIndicatorProps, StatusIndicatorTone };

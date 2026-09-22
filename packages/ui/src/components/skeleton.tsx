import { stylexProps, type WithStyleX } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const pulse = stylex.keyframes({
  "50%": { opacity: 0.5 },
});

const styles = stylex.create({
  text: { height: "1rem", width: "65%" },
  metric: { height: "7rem", width: "100%" },
  chart: { height: "16rem", width: "100%" },
  root: {
    animationDuration: tokens.durationPulse,
    animationIterationCount: "infinite",
    animationName: pulse,
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    backgroundColor: tokens.muted,
    borderRadius: tokens.radiusControl,
    "@media (prefers-reduced-motion: reduce)": {
      animationName: "none",
    },
  },
});

type SkeletonProps = WithStyleX<React.ComponentProps<"div">> & {
  variant?: "text" | "metric" | "chart";
};

function Skeleton({ className, styleX, variant = "text", ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      {...stylexProps([styles.root, styles[variant], styleX], className)}
      {...props}
    />
  );
}

export { Skeleton };

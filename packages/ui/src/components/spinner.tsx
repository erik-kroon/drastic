import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { stylexProps, type WithStyleX } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";
import { Loader2Icon } from "lucide-react";

const spin = stylex.keyframes({
  to: { transform: "rotate(360deg)" },
});

const styles = stylex.create({
  root: {
    animationDuration: tokens.durationSpin,
    animationIterationCount: "infinite",
    animationName: spin,
    animationTimingFunction: "linear",
    height: "1rem",
    width: "1rem",
    "@media (prefers-reduced-motion: reduce)": {
      animationName: "none",
    },
  },
});

type SpinnerProps = WithStyleX<React.ComponentProps<"svg">>;

function Spinner({ className, styleX, ...props }: SpinnerProps) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      {...stylexProps([styles.root, styleX], className)}
      {...props}
    />
  );
}

export { Spinner };

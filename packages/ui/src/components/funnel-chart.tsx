import * as stylex from "@stylexjs/stylex";
import { Button } from "@open-erp/ui/components/button";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  list: { display: "grid", gap: tokens.space6, listStyle: "none", padding: 0, margin: 0 },
  step: { display: "grid", gap: tokens.space2, minWidth: 0 },
  heading: {
    display: "flex",
    gap: tokens.space3,
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
  },
  label: { display: "flex", gap: tokens.space3, alignItems: "center", fontSize: tokens.fontSizeSm },
  index: {
    display: "grid",
    placeItems: "center",
    borderRadius: tokens.radiusControl,
    backgroundColor: tokens.secondary,
    width: tokens.space8,
    height: tokens.space8,
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  },
  values: {
    fontVariantNumeric: "tabular-nums",
    display: "flex",
    alignItems: "center",
    gap: tokens.space3,
    fontSize: tokens.fontSizeSm,
  },
  muted: { color: tokens.mutedForeground },
  track: {
    height: tokens.space3,
    backgroundColor: tokens.secondary,
    borderRadius: tokens.radiusControl,
    overflow: "hidden",
  },
  fill: (width: number) => ({
    width: `${width}%`,
    height: "100%",
    backgroundColor: tokens.primary,
    borderRadius: tokens.radiusControl,
  }),
});

/** Ordered conversion steps; the caller supplies localized counts and rates, including suppressed values. */
export function FunnelChart({
  label,
  steps,
  onOpen,
}: {
  label: string;
  steps: readonly { label: string; count: string; rate: string; fraction: number }[];
  onOpen?: (index: number) => void;
}) {
  return (
    <ol aria-label={label} {...stylex.props(styles.list)}>
      {steps.map((step, index) => (
        <li key={index} {...stylex.props(styles.step)}>
          <div {...stylex.props(styles.heading)}>
            <div {...stylex.props(styles.label)}>
              <span {...stylex.props(styles.index)}>{index + 1}</span>
              {onOpen ? (
                <Button size="xl" variant="ghost" onClick={() => onOpen(index)}>
                  {step.label}
                </Button>
              ) : (
                step.label
              )}
            </div>
            <div {...stylex.props(styles.values)}>
              <strong>{step.count}</strong>
              <span {...stylex.props(styles.muted)}>{step.rate}</span>
            </div>
          </div>
          <div aria-hidden="true" {...stylex.props(styles.track)}>
            <div {...stylex.props(styles.fill(Math.min(100, Math.max(0, step.fraction * 100))))} />
          </div>
        </li>
      ))}
    </ol>
  );
}

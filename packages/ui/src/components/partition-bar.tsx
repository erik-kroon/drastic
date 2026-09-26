import { stylexProps, type StyleXStyles, type WithStyleX } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";
import type * as React from "react";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  root: {
    display: "flex",
    gap: tokens.space1,
    listStyle: "none",
    margin: 0,
    padding: 0,
    width: "100%",
  },
  segment: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.space1_5,
    minWidth: 0,
  },
  segmentSize: (basis: string) => ({ flexBasis: basis }),
  bar: {
    backgroundColor: tokens.muted,
    borderRadius: tokens.radiusFull,
    height: "0.5rem",
    overflow: "hidden",
    width: "100%",
  },
  fill: { display: "block", backgroundColor: tokens.primary, height: "100%", width: "100%" },
  fillColor: (color: string) => ({ backgroundColor: color }),
  label: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeCompact,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

type Partition = {
  ariaLabel?: string;
  color?: string;
  label: string;
  value: number;
};

type PartitionBarProps = WithStyleX<Omit<React.ComponentProps<"ul">, "children">> & {
  items: readonly Partition[];
  styleX?: StyleXStyles;
  valueLabel?: (item: Partition, total: number) => string;
};

function PartitionBar({
  className,
  items,
  styleX,
  valueLabel = (item, total) => `${item.value} of ${total}`,
  ...props
}: PartitionBarProps) {
  const total = items.reduce(
    (sum, item) => sum + (Number.isFinite(item.value) ? Math.max(0, item.value) : 0),
    0,
  );

  return (
    <ul data-slot="partition-bar" {...stylexProps([styles.root, styleX], className)} {...props}>
      {items.map((item, index) => {
        const value = Math.max(0, item.value);
        const label = item.label;

        return (
          <li
            key={index}
            aria-label={item.ariaLabel ?? `${label}: ${valueLabel(item, total)}`}
            {...stylex.props(
              styles.segment,
              styles.segmentSize(
                total > 0 ? `${(value / total) * 100}%` : `${100 / Math.max(items.length, 1)}%`,
              ),
            )}
          >
            <span aria-hidden="true" {...stylex.props(styles.bar)}>
              <span
                {...stylex.props(styles.fill, item.color ? styles.fillColor(item.color) : null)}
              />
            </span>
            <span {...stylex.props(styles.label)}>{item.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

export { PartitionBar };

export type { Partition, PartitionBarProps };

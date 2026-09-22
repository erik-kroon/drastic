import { stylexProps, type StyleXStyles, type WithStyleX } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";
import type * as React from "react";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const DAY = 86_400_000;

const styles = stylex.create({
  root: { overflowX: "auto", paddingBlockEnd: tokens.space1 },
  grid: {
    display: "grid",
    gap: tokens.space0_75,
    gridAutoFlow: "column",
    gridAutoColumns: "0.625rem",
    gridTemplateRows: "repeat(7, 0.625rem)",
    minWidth: "max-content",
  },
  cell: {
    backgroundColor: tokens.muted,
    borderRadius: tokens.radiusDetail,
    display: "block",
    height: "0.625rem",
    width: "0.625rem",
  },
});

type HeatmapDatum = { date: Date | string | number; value: number };
type HeatmapProps = WithStyleX<Omit<React.ComponentProps<"div">, "children">> & {
  color?: string;
  data: readonly HeatmapDatum[];
  dateLabel?: (date: Date) => string;
  endDate?: Date | string | number;
  levels?: number;
  startDate?: Date | string | number;
  styleX?: StyleXStyles;
  valueLabel?: (value: number) => string;
};

function dayKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function startOfUtcDay(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function Heatmap({
  "aria-label": ariaLabel = "Activity heatmap",
  className,
  color = tokens.primary,
  data,
  dateLabel = (date) => date.toLocaleDateString(),
  endDate,
  levels = 5,
  startDate,
  styleX,
  valueLabel = (value) => `${value}`,
  ...props
}: HeatmapProps) {
  const values = new Map(
    data.map((item) => [dayKey(startOfUtcDay(item.date)), Math.max(0, item.value)]),
  );
  const dates = data.map((item) => startOfUtcDay(item.date).getTime()).filter(Number.isFinite);
  const end = startOfUtcDay(endDate ?? (dates.length > 0 ? Math.max(...dates) : Date.now()));
  const start = startOfUtcDay(startDate ?? (dates.length > 0 ? Math.min(...dates) : end));
  const max = Math.max(0, ...values.values());
  const cells: React.ReactNode[] = [];

  for (let time = start.getTime(); time <= end.getTime(); time += DAY) {
    const date = new Date(time);
    const value = values.get(dayKey(date)) ?? 0;
    const level =
      max > 0 && value > 0 ? Math.max(1, Math.ceil((value / max) * Math.max(1, levels - 1))) : 0;
    const label = `${dateLabel(date)}: ${valueLabel(value)}`;
    cells.push(
      <time
        aria-label={label}
        dateTime={dayKey(date)}
        key={time}
        role="listitem"
        title={label}
        {...stylexProps(
          [styles.cell],
          undefined,
          level > 0
            ? {
                backgroundColor: `color-mix(in oklch, ${color} ${25 + (level / Math.max(1, levels - 1)) * 75}%, ${tokens.muted})`,
              }
            : undefined,
        )}
      />,
    );
  }

  return (
    <div {...stylexProps([styles.root, styleX], className)} {...props}>
      <div aria-label={ariaLabel} role="list" {...stylex.props(styles.grid)}>
        {cells}
      </div>
    </div>
  );
}

export { Heatmap };
export type { HeatmapDatum, HeatmapProps };

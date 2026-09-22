"use client";

import { stylexProps, type StyleXStyles } from "@open-erp/ui/lib/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const styles = stylex.create({
  root: {
    color: tokens.mutedForeground,
    display: "flex",
    flexDirection: "column",
    gap: tokens.space2,
    margin: 0,
    minHeight: "12rem",
    minWidth: 0,
    width: "100%",
  },
  canvas: { flex: "1", minHeight: "12rem", minWidth: 0, overflow: "clip" },
  canvasHeight: (height: number) => ({ height }),
  summary: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeightNormal,
    margin: 0,
  },
  srOnly: {
    clip: "rect(0,0,0,0)",
    clipPath: "inset(50%)",
    height: 1,
    overflow: "hidden",
    position: "absolute",
    whiteSpace: "nowrap",
    width: 1,
  },
  table: { borderCollapse: "collapse", fontSize: tokens.fontSizeXs, width: "100%" },
  cell: {
    borderBottomColor: tokens.border,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    padding: tokens.space1_5,
    textAlign: "start",
  },
});
type ChartType = "area" | "bar" | "line";
interface ChartDatum {
  [key: string]: string | number | null | undefined;
}
type ChartSeries = {
  color: string;
  dataKey: string;
  label: string;
  dashed?: boolean;
  valueFormatter?: (value: ChartDatum[string]) => string;
};
type ChartProps = {
  ariaLabel: string;
  className?: string;
  data: readonly ChartDatum[];
  description: string;
  height?: number;
  series: readonly ChartSeries[];
  showDataTable?: boolean;
  showLegend?: boolean;
  styleX?: StyleXStyles;
  type?: ChartType;
  xKey: string;
  xLabel?: string;
};
function stringValue(value: ChartDatum[string]) {
  return value == null ? "—" : String(value);
}
function ChartDataTable({
  data,
  series,
  xKey,
  xLabel = xKey,
}: Pick<ChartProps, "data" | "series" | "xKey" | "xLabel">) {
  return (
    <table {...stylex.props(styles.table)}>
      <thead>
        <tr>
          <th scope="col" {...stylex.props(styles.cell)}>
            {xLabel}
          </th>
          {series.map((item) => (
            <th key={item.dataKey} scope="col" {...stylex.props(styles.cell)}>
              {item.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, index) => (
          <tr key={`${stringValue(row[xKey])}-${index}`}>
            <th scope="row" {...stylex.props(styles.cell)}>
              {stringValue(row[xKey])}
            </th>
            {series.map((item) => (
              <td key={item.dataKey} {...stylex.props(styles.cell)}>
                {item.valueFormatter?.(row[item.dataKey]) ?? stringValue(row[item.dataKey])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function Chart({
  ariaLabel,
  className,
  data,
  description,
  height = 240,
  series,
  showDataTable = false,
  showLegend = true,
  styleX,
  type = "line",
  xKey,
  xLabel,
}: ChartProps) {
  const common = {
    data: [...data],
    margin: { bottom: 4, left: 0, right: 12, top: 8 },
  };
  const axes = (
    <>
      <CartesianGrid stroke={tokens.border} strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey={xKey}
        fontSize={11}
        stroke={tokens.mutedForeground}
        tickLine={false}
        minTickGap={36}
        axisLine={false}
      />
      <YAxis
        axisLine={false}
        allowDecimals={false}
        fontSize={11}
        stroke={tokens.mutedForeground}
        tickLine={false}
        width={40}
      />
      <Tooltip
        contentStyle={{
          background: tokens.popover,
          border: `1px solid ${tokens.border}`,
          borderRadius: tokens.radiusControl,
          fontSize: 12,
        }}
      />
      {showLegend ? <Legend /> : null}
    </>
  );
  const marks = series.map((item) =>
    type === "bar" ? (
      <Bar
        isAnimationActive={false}
        dataKey={item.dataKey}
        fill={item.color}
        key={item.dataKey}
        name={item.label}
        radius={[3, 3, 0, 0]}
      />
    ) : type === "area" ? (
      <Area
        isAnimationActive={false}
        dataKey={item.dataKey}
        fill={item.color}
        fillOpacity={0.15}
        key={item.dataKey}
        name={item.label}
        stroke={item.color}
        strokeDasharray={item.dashed ? "4 4" : undefined}
        type="linear"
      />
    ) : (
      <Line
        isAnimationActive={false}
        dataKey={item.dataKey}
        dot={false}
        key={item.dataKey}
        name={item.label}
        stroke={item.color}
        strokeDasharray={item.dashed ? "4 4" : undefined}
        strokeWidth={2}
        type="linear"
      />
    ),
  );
  const graph =
    type === "bar" ? (
      <BarChart accessibilityLayer={false} {...common}>
        {axes}
        {marks}
      </BarChart>
    ) : type === "area" ? (
      <AreaChart accessibilityLayer={false} {...common}>
        {axes}
        {marks}
      </AreaChart>
    ) : (
      <LineChart accessibilityLayer={false} {...common}>
        {axes}
        {marks}
      </LineChart>
    );
  return (
    <figure aria-label={ariaLabel} {...stylexProps([styles.root, styleX], className)}>
      <p {...stylex.props(styles.summary)}>{description}</p>
      <div aria-hidden="true" {...stylex.props(styles.canvas, styles.canvasHeight(height))}>
        <ResponsiveContainer height="100%" width="100%">
          {graph}
        </ResponsiveContainer>
      </div>
      <div {...stylex.props(showDataTable ? undefined : styles.srOnly)}>
        <ChartDataTable data={data} series={series} xKey={xKey} xLabel={xLabel} />
      </div>
    </figure>
  );
}
export { Chart, ChartDataTable };
export type { ChartDatum, ChartProps, ChartSeries, ChartType };

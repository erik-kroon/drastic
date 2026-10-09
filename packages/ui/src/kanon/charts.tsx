import * as stylex from "@stylexjs/stylex";
import { useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { useKanonCopy } from "@open-erp/ui/kanon/copy";
import { kanon } from "@open-erp/ui/theme/kanon.stylex";

/**
 * Charts draw from exact minor-unit strings (scale 2). Drawing converts to
 * kronor; every figure a person reads comes from the caller's exact formatter,
 * and every chart has the same rows as a table.
 */
type Minor = string;

type Format = (minor: Minor) => string;

const styles = stylex.create({
  figure: {
    borderColor: kanon.colorRule,
    borderRadius: kanon.radiusCard,
    borderStyle: "solid",
    borderWidth: 1,
    display: "flex",
    flexDirection: "column",
    fontFamily: kanon.fontUi,
    gap: kanon.space3,
    margin: 0,
    minWidth: 0,
    paddingBlock: kanon.space4,
    paddingInline: kanon.space5,
  },
  head: { alignItems: "baseline", display: "flex", gap: kanon.space4, minWidth: 0 },
  caption: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    gap: kanon.space1,
    minWidth: 0,
  },
  title: {
    color: kanon.colorText,
    fontSize: kanon.textSection,
    fontWeight: kanon.weightSemibold,
    lineHeight: kanon.leadingSection,
  },
  description: {
    color: kanon.colorCaption,
    fontSize: kanon.textCaption,
    lineHeight: kanon.leadingBody,
  },
  toggle: {
    backgroundColor: "transparent",
    borderWidth: 0,
    color: { default: kanon.colorAction, ":hover": kanon.colorActionHover },
    cursor: "pointer",
    flexShrink: 0,
    fontFamily: kanon.fontUi,
    fontSize: kanon.textCaption,
    fontWeight: kanon.weightMedium,
    lineHeight: kanon.leadingBody,
    padding: 0,
  },
  legend: { display: "flex", flexWrap: "wrap", gap: kanon.space4 },
  key: {
    alignItems: "center",
    color: kanon.colorCaption,
    display: "flex",
    fontSize: kanon.textCaption,
    gap: kanon.space2,
    lineHeight: kanon.leadingBody,
  },
  swatch: { borderRadius: kanon.radiusSheet, flexShrink: 0, height: 8, width: 8 },
  swatchColor: (color: string) => ({ backgroundColor: color }),
  tick: { flexShrink: 0, height: 2, width: 12 },
  canvas: { minWidth: 0, width: "100%" },
  canvasHeight: (height: number) => ({ height }),
  hidden: {
    clip: "rect(0,0,0,0)",
    clipPath: "inset(50%)",
    height: 1,
    overflow: "hidden",
    position: "absolute",
    whiteSpace: "nowrap",
    width: 1,
  },
  table: {
    borderCollapse: "collapse",
    color: kanon.colorText,
    fontSize: kanon.textBody,
    lineHeight: kanon.leadingBody,
    width: "100%",
  },
  cell: {
    borderBottomColor: kanon.colorRule,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    paddingBlock: kanon.space2,
    paddingInline: 0,
    textAlign: "start",
  },
  headCell: {
    color: kanon.colorCaption,
    fontSize: kanon.textCaption,
    fontWeight: kanon.weightRegular,
  },
  number: {
    fontVariantNumeric: "tabular-nums",
    paddingInlineStart: kanon.space4,
    textAlign: "end",
  },
  spark: { display: "inline-flex", flexShrink: 0 },
  sparkSize: (width: number, height: number) => ({ height, width }),
});

const axisText = { fill: kanon.colorCaption, fontSize: 11 };

const barWidth = 18;

const axisWidth = 76;

const plotTop = 8;

const xAxisHeight = 30;

const labelGap = 14;

/** Round steps (1, 2 or 5 times a power of ten) spanning low to high, always through zero. */
function niceTicks(low: number, high: number, count = 4) {
  const span = Math.max(high - low, 1);
  const rough = span / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((factor) => factor * power >= rough) ?? 10) * power;
  const from = Math.floor(low / step) * step;
  const to = Math.ceil(high / step) * step;

  return Array.from(
    { length: Math.round((to - from) / step) + 1 },
    (_, index) => from + index * step,
  );
}

/** Places end labels at their values, then pushes overlapping ones apart. */
function layoutLabels<Label extends { value: number }>(
  labels: ReadonlyArray<Label>,
  toPixel: (value: number) => number,
  bottom: number,
) {
  const placed = labels
    .map((label) => ({ ...label, y: toPixel(label.value) }))
    .toSorted((left, right) => left.y - right.y);

  for (let index = 1; index < placed.length; index += 1) {
    const previous = placed[index - 1]!;
    const current = placed[index]!;

    if (current.y - previous.y < labelGap) current.y = previous.y + labelGap;
  }

  // Pushed past the plot, the stack moves back up from the bottom edge.
  for (let index = placed.length - 1; index >= 0; index -= 1) {
    const limit = index === placed.length - 1 ? bottom : placed[index + 1]!.y - labelGap;

    if (placed[index]!.y > limit) placed[index]!.y = limit;
  }

  return placed;
}

function kronor(minor: Minor | null) {
  return minor === null ? null : Number(minor) / 100;
}

function useTick() {
  const copy = useKanonCopy();

  return (value: number) =>
    Math.abs(value) >= 1000
      ? `${new Intl.NumberFormat("sv-SE").format(Math.round(value / 1000))} ${copy.thousands}`
      : new Intl.NumberFormat("sv-SE").format(value);
}

type TableColumn = { label: string; numeric?: boolean };

function ChartFigure(props: {
  title: string;
  description: string;
  legend?: ReactNode;
  height: number;
  columns: ReadonlyArray<TableColumn>;
  rows: ReadonlyArray<{ key: string; cells: ReadonlyArray<string> }>;
  children: ReactNode;
}) {
  const copy = useKanonCopy();
  const [table, setTable] = useState(false);

  return (
    <figure aria-label={props.title} {...stylex.props(styles.figure)}>
      <div {...stylex.props(styles.head)}>
        <figcaption {...stylex.props(styles.caption)}>
          <span {...stylex.props(styles.title)}>{props.title}</span>
          <span {...stylex.props(styles.description)}>{props.description}</span>
        </figcaption>
        <button type="button" {...stylex.props(styles.toggle)} onClick={() => setTable(!table)}>
          {table ? copy.showChart : copy.showTable}
        </button>
      </div>
      {table ? null : props.legend}
      {table ? null : (
        <div aria-hidden="true" {...stylex.props(styles.canvas, styles.canvasHeight(props.height))}>
          <ResponsiveContainer height="100%" width="100%">
            {props.children}
          </ResponsiveContainer>
        </div>
      )}
      <div {...stylex.props(table ? undefined : styles.hidden)}>
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              {props.columns.map((column) => (
                <th
                  key={column.label}
                  scope="col"
                  {...stylex.props(styles.cell, styles.headCell, column.numeric && styles.number)}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.key}>
                {row.cells.map((cell, index) =>
                  index === 0 ? (
                    <th
                      key={props.columns[index]?.label}
                      scope="row"
                      {...stylex.props(styles.cell)}
                    >
                      {cell}
                    </th>
                  ) : (
                    <td
                      key={props.columns[index]?.label}
                      {...stylex.props(styles.cell, props.columns[index]?.numeric && styles.number)}
                    >
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function Key({ color, label, tick }: { color: string; label: string; tick?: boolean }) {
  return (
    <span {...stylex.props(styles.key)}>
      <span {...stylex.props(tick ? styles.tick : styles.swatch, styles.swatchColor(color))} />
      {label}
    </span>
  );
}

/** One measure per month with the same month last year as a tick above or inside the bar. */
export function MonthlyComparison(props: {
  title: string;
  description: string;
  measure: string;
  months: ReadonlyArray<{ label: string; current: Minor | null; previous: Minor | null }>;
  format: Format;
  height?: number;
}) {
  const copy = useKanonCopy();
  const tick = useTick();

  const data = props.months.map((month) => ({
    label: month.label,
    current: kronor(month.current),
    previous: kronor(month.previous),
  }));

  return (
    <ChartFigure
      title={props.title}
      description={props.description}
      height={props.height ?? 220}
      legend={
        <div {...stylex.props(styles.legend)}>
          <Key color={kanon.colorAction} label={props.measure} />
          <Key color={kanon.colorChartMark} label={copy.previousYear} tick />
        </div>
      }
      columns={[
        { label: copy.month },
        { label: props.measure, numeric: true },
        { label: copy.previousYear, numeric: true },
      ]}
      rows={props.months.map((month) => ({
        key: month.label,
        cells: [
          month.label,
          month.current === null ? copy.missing : props.format(month.current),
          month.previous === null ? copy.missing : props.format(month.previous),
        ],
      }))}
    >
      <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={kanon.colorChartGrid} vertical={false} />
        <XAxis dataKey="label" tick={axisText} tickLine={false} axisLine={false} />
        <YAxis
          tick={axisText}
          tickFormatter={tick}
          tickLine={false}
          axisLine={false}
          width={axisWidth}
        />
        <ReferenceLine y={0} stroke={kanon.colorControl} />
        <Bar
          dataKey="current"
          barSize={barWidth}
          fill={kanon.colorAction}
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        />
        {/* A tick wider than the bar, centred on it, so last year reads above or inside it. */}
        <Line
          dataKey="previous"
          stroke="none"
          isAnimationActive={false}
          activeDot={false}
          dot={(point: { cx?: number | null; cy?: number | null; index?: number }) =>
            point.cx == null || point.cy == null ? (
              <g key={point.index} />
            ) : (
              <line
                key={point.index}
                x1={point.cx - barWidth / 2 - 3}
                x2={point.cx + barWidth / 2 + 3}
                y1={point.cy}
                y2={point.cy}
                stroke={kanon.colorChartMark}
                strokeWidth={2}
              />
            )
          }
        />
      </ComposedChart>
    </ChartFigure>
  );
}

/**
 * Daily balance lines ending in labels instead of a legend, with an optional
 * reserve line. The value range always includes the reserve and zero.
 */
export function ForecastLines(props: {
  title: string;
  description: string;
  points: ReadonlyArray<{ on: string; label: string; closing: Minor; low?: Minor }>;
  labels: { closing: string; low?: string; reserve?: string };
  reserve?: Minor;
  format: Format;
  height?: number;
}) {
  const copy = useKanonCopy();
  const tick = useTick();
  const reserve = props.reserve === undefined ? undefined : (kronor(props.reserve) ?? undefined);

  const data = props.points.map((point) => ({
    on: point.label,
    closing: kronor(point.closing),
    low: point.low === undefined ? null : kronor(point.low),
  }));

  const values = data.flatMap((point) => [point.closing ?? 0, point.low ?? point.closing ?? 0]);

  const ticks = niceTicks(
    Math.min(0, reserve ?? 0, ...values),
    Math.max(0, reserve ?? 0, ...values),
  );

  const low = ticks[0]!;
  const high = ticks.at(-1)!;
  const height = props.height ?? 240;
  const plotHeight = height - plotTop - xAxisHeight;
  const end = data.at(-1);
  const last = data.length - 1;

  // Every line ends in its name; the reserve is named at the same edge.
  const labels = layoutLabels(
    [
      { text: props.labels.closing, value: end?.closing ?? 0, colour: kanon.colorText },
      ...(props.labels.low
        ? [
            {
              text: props.labels.low,
              value: end?.low ?? end?.closing ?? 0,
              colour: kanon.colorCaption,
            },
          ]
        : []),
      ...(reserve !== undefined && props.labels.reserve
        ? [{ text: props.labels.reserve, value: reserve, colour: kanon.colorWarning }]
        : []),
    ],
    (value) => plotTop + ((high - value) / (high - low)) * plotHeight,
    plotTop + plotHeight - labelGap / 2,
  );

  const endLabels = (label: { x?: number | string; index?: number }) =>
    label.index === last ? (
      <g>
        {labels.map((entry) => (
          <text
            key={entry.text}
            x={Number(label.x) + 8}
            y={entry.y}
            dominantBaseline="middle"
            fill={entry.colour}
            fontSize={11}
          >
            {entry.text}
          </text>
        ))}
      </g>
    ) : null;

  const columns: TableColumn[] = [
    { label: copy.date },
    { label: props.labels.closing, numeric: true },
  ];

  if (props.labels.low) columns.push({ label: props.labels.low, numeric: true });

  return (
    <ChartFigure
      title={props.title}
      description={props.description}
      height={height}
      columns={columns}
      rows={props.points.map((point) => ({
        key: point.on,
        cells: [
          point.label,
          props.format(point.closing),
          ...(props.labels.low && point.low !== undefined ? [props.format(point.low)] : []),
        ],
      }))}
    >
      <LineChart data={data} margin={{ top: plotTop, right: 128, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={kanon.colorChartGrid} vertical={false} />
        <XAxis
          dataKey="on"
          height={xAxisHeight}
          tick={axisText}
          tickLine={false}
          axisLine={false}
          minTickGap={28}
        />
        <YAxis
          domain={[low, high]}
          ticks={ticks}
          tick={axisText}
          tickFormatter={tick}
          tickLine={false}
          axisLine={false}
          width={axisWidth}
        />
        <ReferenceLine y={0} stroke={kanon.colorControl} />
        {reserve === undefined ? null : (
          <ReferenceLine y={reserve} stroke={kanon.colorWarning} strokeDasharray="4 4" />
        )}
        {props.labels.low ? (
          <Line
            dataKey="low"
            stroke={kanon.colorCaption}
            strokeDasharray="3 3"
            strokeWidth={1.5}
            dot={false}
            type="stepAfter"
            isAnimationActive={false}
          />
        ) : null}
        <Line
          dataKey="closing"
          stroke={kanon.colorAction}
          strokeWidth={2}
          dot={false}
          type="stepAfter"
          isAnimationActive={false}
        >
          <LabelList content={endLabels} />
        </Line>
      </LineChart>
    </ChartFigure>
  );
}

/** Totals anchored at zero and the changes between them floating from the running total. */
export function Waterfall(props: {
  title: string;
  description: string;
  steps: ReadonlyArray<{ label: string; amount: Minor; kind: "total" | "change" }>;
  format: Format;
  height?: number;
}) {
  const copy = useKanonCopy();
  const tick = useTick();
  let running = 0;

  const data = props.steps.map((step) => {
    const amount = kronor(step.amount) ?? 0;

    if (step.kind === "total") {
      running = amount;

      return { label: step.label, range: [Math.min(0, amount), Math.max(0, amount)], step };
    }

    const from = running;
    running += amount;

    return { label: step.label, range: [Math.min(from, running), Math.max(from, running)], step };
  });

  const ticks = niceTicks(
    Math.min(0, ...data.map((entry) => entry.range[0]!)),
    Math.max(0, ...data.map((entry) => entry.range[1]!)),
  );

  const colour = (step: (typeof props.steps)[number]) =>
    step.kind === "total"
      ? kanon.colorSecondary
      : BigInt(step.amount) < 0n
        ? kanon.colorError
        : kanon.colorSuccess;

  return (
    <ChartFigure
      title={props.title}
      description={props.description}
      height={props.height ?? 220}
      columns={[{ label: copy.step }, { label: copy.amount, numeric: true }]}
      rows={props.steps.map((step) => ({
        key: step.label,
        cells: [step.label, props.format(step.amount)],
      }))}
    >
      <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap="24%">
        <CartesianGrid stroke={kanon.colorChartGrid} vertical={false} />
        <XAxis dataKey="label" tick={axisText} tickLine={false} axisLine={false} interval={0} />
        <YAxis
          domain={[ticks[0]!, ticks.at(-1)!]}
          ticks={ticks}
          tick={axisText}
          tickFormatter={tick}
          tickLine={false}
          axisLine={false}
          width={axisWidth}
        />
        <ReferenceLine y={0} stroke={kanon.colorControl} />
        <Bar dataKey="range" radius={2} isAnimationActive={false}>
          {data.map((entry) => (
            <Cell key={entry.label} fill={colour(entry.step)} />
          ))}
        </Bar>
      </BarChart>
    </ChartFigure>
  );
}

/** A trend beside a figure. The accessible name states the first and last values. */
export function Sparkline(props: {
  label: string;
  values: ReadonlyArray<Minor>;
  format: Format;
  width?: number;
  height?: number;
}) {
  const copy = useKanonCopy();
  const data = props.values.map((value, index) => ({ index, value: kronor(value) }));
  const first = props.values[0];
  const last = props.values.at(-1);
  const width = props.width ?? 96;
  const height = props.height ?? 28;

  return (
    <span
      role="img"
      aria-label={
        first === undefined || last === undefined
          ? props.label
          : `${props.label}: ${props.format(first)} ${copy.through} ${props.format(last)}`
      }
      {...stylex.props(styles.spark, styles.sparkSize(width, height))}
    >
      <LineChart
        width={width}
        height={height}
        data={data}
        margin={{ top: 3, right: 3, bottom: 3, left: 3 }}
      >
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Line
          dataKey="value"
          stroke={kanon.colorAction}
          strokeWidth={1.5}
          dot={false}
          type="monotone"
          isAnimationActive={false}
        />
      </LineChart>
    </span>
  );
}

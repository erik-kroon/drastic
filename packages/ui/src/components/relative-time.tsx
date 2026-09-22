import { stylexProps, type StyleXStyles, type WithStyleX } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";
import type * as React from "react";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  root: {
    color: tokens.mutedForeground,
    fontVariantNumeric: "tabular-nums",
  },
});
const units: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_557_600_000],
  ["month", 2_629_746_000],
  ["week", 604_800_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1_000],
];
type RelativeTimeProps = WithStyleX<Omit<React.ComponentProps<"time">, "dateTime">> & {
  date: Date | string | number;
  exactLabel?: string;
  locale?: string | string[];
  now?: Date | number;
  numeric?: Intl.RelativeTimeFormatOptions["numeric"];
  styleX?: StyleXStyles;
};
function RelativeTime({
  children,
  className,
  date: value,
  exactLabel,
  locale,
  now = Date.now(),
  numeric = "auto",
  styleX,
  ...props
}: RelativeTimeProps) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const difference = date.getTime() - (now instanceof Date ? now.getTime() : now);
  const [unit, milliseconds] = units.find(([, size]) => Math.abs(difference) >= size) ?? [
    "second",
    1_000,
  ];
  const label = new Intl.RelativeTimeFormat(locale, { numeric }).format(
    Math.round(difference / milliseconds),
    unit,
  );
  return (
    <time
      dateTime={date.toISOString()}
      title={exactLabel ?? date.toLocaleString(locale)}
      {...stylexProps([styles.root, styleX], className)}
      {...props}
    >
      {children ?? label}
    </time>
  );
}
export { RelativeTime };
export type { RelativeTimeProps };

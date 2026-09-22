import * as stylex from "@stylexjs/stylex";
import { createElement, type ComponentPropsWithRef, type ReactNode } from "react";

import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const spacing = {
  none: tokens.space0,
  xs: tokens.space1,
  sm: tokens.space2,
  md: tokens.space3,
  lg: tokens.space4,
  xl: tokens.space6,
  "2xl": tokens.space8,
  "3xl": tokens.space12,
  "4xl": tokens.space16,
  "5xl": tokens.space24,
} as const;

const colors = {
  background: tokens.background,
  surface: tokens.surfaceDefault,
  "surface-hover": tokens.surfaceHover,
  muted: tokens.muted,
  accent: tokens.accent,
  primary: tokens.primary,
  destructive: tokens.destructiveBackground,
  transparent: tokens.transparent,
} as const;

const borders = {
  default: tokens.border,
  active: tokens.borderActive,
  invalid: tokens.controlInvalidBorder,
  transparent: tokens.transparent,
} as const;

const radii = {
  none: tokens.radiusNone,
  control: tokens.radiusControl,
  surface: tokens.radiusSurface,
  overlay: tokens.radiusOverlay,
  full: tokens.radiusFull,
} as const;

const shadows = {
  none: tokens.shadowNone,
  raised: tokens.shadowRaised,
  floating: tokens.shadowFloating,
  overlay: tokens.shadowOverlay,
} as const;

type Space = keyof typeof spacing;
type Background = keyof typeof colors;
type Border = keyof typeof borders;
type Radius = keyof typeof radii;
type Shadow = keyof typeof shadows;

const styles = stylex.create({
  centered: { marginInline: "auto" },
  displayBlock: { display: "block" },
  displayFlex: { display: "flex" },
  displayGrid: { display: "grid" },
  displayInlineFlex: { display: "inline-flex" },
  displayNone: { display: "none" },
  directionRow: { flexDirection: "row" },
  directionColumn: { flexDirection: "column" },
  wrap: { flexWrap: "wrap" },
  noWrap: { flexWrap: "nowrap" },
  alignStart: { alignItems: "flex-start" },
  alignCenter: { alignItems: "center" },
  alignEnd: { alignItems: "flex-end" },
  alignStretch: { alignItems: "stretch" },
  justifyStart: { justifyContent: "flex-start" },
  justifyCenter: { justifyContent: "center" },
  justifyEnd: { justifyContent: "flex-end" },
  justifyBetween: { justifyContent: "space-between" },
  justifyAround: { justifyContent: "space-around" },
  justifyEvenly: { justifyContent: "space-evenly" },
  positionRelative: { position: "relative" },
  positionAbsolute: { position: "absolute" },
  positionSticky: { position: "sticky" },
  positionFixed: { position: "fixed" },
  overflowVisible: { overflow: "visible" },
  overflowHidden: { overflow: "hidden" },
  overflowClip: { overflow: "clip" },
  overflowAuto: { overflow: "auto" },
  overflowScroll: { overflow: "scroll" },
  widthAuto: { width: "auto" },
  widthFull: { width: "100%" },
  widthFit: { width: "fit-content" },
  maxWidthFull: { maxWidth: "100%" },
  maxWidthContent: { maxWidth: "48rem" },
  maxWidthWide: { maxWidth: "80rem" },
  minWidthZero: { minWidth: 0 },
  heightAuto: { height: "auto" },
  heightFull: { height: "100%" },
  heightFit: { height: "fit-content" },
  minHeightZero: { minHeight: 0 },
  minHeightScreen: { minHeight: "100svh" },
  grow: { flexGrow: 1 },
  noGrow: { flexGrow: 0 },
  shrink: { flexShrink: 1 },
  noShrink: { flexShrink: 0 },
  borderNone: { borderWidth: 0 },
  borderThin: { borderStyle: "solid", borderWidth: 1 },
  columnsOne: { gridTemplateColumns: "minmax(0, 1fr)" },
  columnsTwo: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
  columnsThree: { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" },
  columnsFour: { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" },
  columnsTwoSm: {
    gridTemplateColumns: { "@media (min-width: 640px)": "repeat(2, minmax(0, 1fr))" },
  },
  columnsThreeSm: {
    gridTemplateColumns: { "@media (min-width: 640px)": "repeat(3, minmax(0, 1fr))" },
  },
  columnsFourSm: {
    gridTemplateColumns: { "@media (min-width: 640px)": "repeat(4, minmax(0, 1fr))" },
  },
  columnsTwoLg: {
    gridTemplateColumns: { "@media (min-width: 1024px)": "repeat(2, minmax(0, 1fr))" },
  },
  columnsThreeLg: {
    gridTemplateColumns: { "@media (min-width: 1024px)": "repeat(3, minmax(0, 1fr))" },
  },
  columnsFourLg: {
    gridTemplateColumns: { "@media (min-width: 1024px)": "repeat(4, minmax(0, 1fr))" },
  },
  columnFull: { gridColumn: "1 / -1" },
  gap: (value: Space) => ({ gap: spacing[value] }),
  rowGap: (value: Space) => ({ rowGap: spacing[value] }),
  columnGap: (value: Space) => ({ columnGap: spacing[value] }),
  padding: (value: Space) => ({ padding: spacing[value] }),
  paddingBlock: (value: Space) => ({ paddingBlock: spacing[value] }),
  paddingInline: (value: Space) => ({ paddingInline: spacing[value] }),
  paddingBlockStart: (value: Space) => ({ paddingBlockStart: spacing[value] }),
  paddingBlockEnd: (value: Space) => ({ paddingBlockEnd: spacing[value] }),
  paddingInlineStart: (value: Space) => ({ paddingInlineStart: spacing[value] }),
  paddingInlineEnd: (value: Space) => ({ paddingInlineEnd: spacing[value] }),
  margin: (value: Space) => ({ margin: spacing[value] }),
  marginBlock: (value: Space) => ({ marginBlock: spacing[value] }),
  marginInline: (value: Space) => ({ marginInline: spacing[value] }),
  marginBlockStart: (value: Space) => ({ marginBlockStart: spacing[value] }),
  marginBlockEnd: (value: Space) => ({ marginBlockEnd: spacing[value] }),
  marginInlineStart: (value: Space) => ({ marginInlineStart: spacing[value] }),
  marginInlineEnd: (value: Space) => ({ marginInlineEnd: spacing[value] }),
  background: (value: string) => ({ backgroundColor: value }),
  borderColor: (value: string) => ({ borderColor: value }),
  radius: (value: Radius) => ({ borderRadius: radii[value] }),
  shadow: (value: string) => ({ boxShadow: value }),
});

const displayStyles = {
  block: styles.displayBlock,
  flex: styles.displayFlex,
  grid: styles.displayGrid,
  "inline-flex": styles.displayInlineFlex,
  none: styles.displayNone,
} as const;

const directionStyles = { row: styles.directionRow, column: styles.directionColumn } as const;
const wrapStyles = { wrap: styles.wrap, nowrap: styles.noWrap } as const;
const alignStyles = {
  start: styles.alignStart,
  center: styles.alignCenter,
  end: styles.alignEnd,
  stretch: styles.alignStretch,
} as const;
const justifyStyles = {
  start: styles.justifyStart,
  center: styles.justifyCenter,
  end: styles.justifyEnd,
  between: styles.justifyBetween,
  around: styles.justifyAround,
  evenly: styles.justifyEvenly,
} as const;
const positionStyles = {
  relative: styles.positionRelative,
  absolute: styles.positionAbsolute,
  sticky: styles.positionSticky,
  fixed: styles.positionFixed,
} as const;
const overflowStyles = {
  visible: styles.overflowVisible,
  hidden: styles.overflowHidden,
  clip: styles.overflowClip,
  auto: styles.overflowAuto,
  scroll: styles.overflowScroll,
} as const;
const widthStyles = { auto: styles.widthAuto, full: styles.widthFull, fit: styles.widthFit };
const maxWidthStyles = {
  full: styles.maxWidthFull,
  content: styles.maxWidthContent,
  wide: styles.maxWidthWide,
};
const minWidthStyles = { zero: styles.minWidthZero };
const heightStyles = { auto: styles.heightAuto, full: styles.heightFull, fit: styles.heightFit };
const minHeightStyles = { zero: styles.minHeightZero, screen: styles.minHeightScreen };
const borderWidthStyles = { none: styles.borderNone, thin: styles.borderThin };
const columnsStyles = {
  1: styles.columnsOne,
  2: styles.columnsTwo,
  3: styles.columnsThree,
  4: styles.columnsFour,
};
const responsiveSmColumnStyles = {
  2: styles.columnsTwoSm,
  3: styles.columnsThreeSm,
  4: styles.columnsFourSm,
};
const responsiveLgColumnStyles = {
  2: styles.columnsTwoLg,
  3: styles.columnsThreeLg,
  4: styles.columnsFourLg,
};
const columnStyles = { full: styles.columnFull };

const boxElements = [
  "div",
  "main",
  "section",
  "label",
  "article",
  "nav",
  "aside",
  "header",
  "footer",
  "ul",
  "ol",
  "li",
  "form",
  "fieldset",
  "dl",
  "dt",
  "dd",
] as const;

type BoxElement = (typeof boxElements)[number];

type BoxStyleProps = {
  centered?: boolean;
  display?: keyof typeof displayStyles;
  flexDirection?: keyof typeof directionStyles;
  flexWrap?: keyof typeof wrapStyles;
  alignItems?: keyof typeof alignStyles;
  justifyContent?: keyof typeof justifyStyles;
  position?: keyof typeof positionStyles;
  overflow?: keyof typeof overflowStyles;
  width?: keyof typeof widthStyles;
  maxWidth?: keyof typeof maxWidthStyles;
  minWidth?: keyof typeof minWidthStyles;
  height?: keyof typeof heightStyles;
  minHeight?: keyof typeof minHeightStyles;
  flexGrow?: boolean;
  flexShrink?: boolean;
  columns?: keyof typeof columnsStyles;
  columnsAtSm?: keyof typeof responsiveSmColumnStyles;
  columnsAtLg?: keyof typeof responsiveLgColumnStyles;
  gridColumn?: keyof typeof columnStyles;
  gap?: Space;
  rowGap?: Space;
  columnGap?: Space;
  padding?: Space;
  paddingBlock?: Space;
  paddingInline?: Space;
  paddingBlockStart?: Space;
  paddingBlockEnd?: Space;
  paddingInlineStart?: Space;
  paddingInlineEnd?: Space;
  margin?: Space;
  marginBlock?: Space;
  marginInline?: Space;
  marginBlockStart?: Space;
  marginBlockEnd?: Space;
  marginInlineStart?: Space;
  marginInlineEnd?: Space;
  backgroundColor?: Background;
  borderWidth?: keyof typeof borderWidthStyles;
  borderColor?: Border;
  borderRadius?: Radius;
  boxShadow?: Shadow;
};

export type BoxProps<T extends BoxElement = "div"> = BoxStyleProps &
  Omit<ComponentPropsWithRef<T>, keyof BoxStyleProps | "as" | "className" | "style"> & {
    as?: T;
    children?: ReactNode;
  };

export function Box<T extends BoxElement = "div">({
  as,
  centered,
  display,
  flexDirection,
  flexWrap,
  alignItems,
  justifyContent,
  position,
  overflow,
  width,
  maxWidth,
  minWidth,
  height,
  minHeight,
  flexGrow,
  flexShrink,
  columns,
  columnsAtSm,
  columnsAtLg,
  gridColumn,
  gap,
  rowGap,
  columnGap,
  padding,
  paddingBlock,
  paddingInline,
  paddingBlockStart,
  paddingBlockEnd,
  paddingInlineStart,
  paddingInlineEnd,
  margin,
  marginBlock,
  marginInline,
  marginBlockStart,
  marginBlockEnd,
  marginInlineStart,
  marginInlineEnd,
  backgroundColor,
  borderWidth,
  borderColor,
  borderRadius,
  boxShadow,
  ...props
}: BoxProps<T>) {
  return createElement(as ?? "div", {
    ...props,
    ...stylex.props(
      centered && styles.centered,
      display && displayStyles[display],
      flexDirection && directionStyles[flexDirection],
      flexWrap && wrapStyles[flexWrap],
      alignItems && alignStyles[alignItems],
      justifyContent && justifyStyles[justifyContent],
      position && positionStyles[position],
      overflow && overflowStyles[overflow],
      width && widthStyles[width],
      maxWidth && maxWidthStyles[maxWidth],
      minWidth && minWidthStyles[minWidth],
      height && heightStyles[height],
      minHeight && minHeightStyles[minHeight],
      flexGrow !== undefined && (flexGrow ? styles.grow : styles.noGrow),
      flexShrink !== undefined && (flexShrink ? styles.shrink : styles.noShrink),
      columns && columnsStyles[columns],
      columnsAtSm && responsiveSmColumnStyles[columnsAtSm],
      columnsAtLg && responsiveLgColumnStyles[columnsAtLg],
      gridColumn && columnStyles[gridColumn],
      gap && styles.gap(gap),
      rowGap && styles.rowGap(rowGap),
      columnGap && styles.columnGap(columnGap),
      padding && styles.padding(padding),
      paddingBlock && styles.paddingBlock(paddingBlock),
      paddingInline && styles.paddingInline(paddingInline),
      paddingBlockStart && styles.paddingBlockStart(paddingBlockStart),
      paddingBlockEnd && styles.paddingBlockEnd(paddingBlockEnd),
      paddingInlineStart && styles.paddingInlineStart(paddingInlineStart),
      paddingInlineEnd && styles.paddingInlineEnd(paddingInlineEnd),
      margin && styles.margin(margin),
      marginBlock && styles.marginBlock(marginBlock),
      marginInline && styles.marginInline(marginInline),
      marginBlockStart && styles.marginBlockStart(marginBlockStart),
      marginBlockEnd && styles.marginBlockEnd(marginBlockEnd),
      marginInlineStart && styles.marginInlineStart(marginInlineStart),
      marginInlineEnd && styles.marginInlineEnd(marginInlineEnd),
      backgroundColor && styles.background(colors[backgroundColor]),
      borderWidth && borderWidthStyles[borderWidth],
      borderColor && styles.borderColor(borders[borderColor]),
      borderRadius && styles.radius(borderRadius),
      boxShadow && styles.shadow(shadows[boxShadow]),
    ),
  });
}

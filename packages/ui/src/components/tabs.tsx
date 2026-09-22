"use client";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { stylexProps, type WithStyleX, stateStylexProps } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  root: { minWidth: 0, width: "100%" },
  list: {
    alignItems: "center",
    borderBottomColor: tokens.border,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    gap: tokens.space1,
    minWidth: 0,
    overflowX: "auto",
    paddingInline: tokens.space1,
    position: "relative",
  },
  trigger: {
    alignItems: "center",
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.mutedAlpha60,
    },
    borderRadius: tokens.radiusMd,
    color: { default: tokens.mutedForeground, ":hover": tokens.foreground },
    cursor: "default",
    display: "flex",
    fontSize: tokens.fontSizeXs,
    fontWeight: tokens.fontWeightMedium,
    gap: tokens.space2,
    minHeight: "2.75rem",
    flexShrink: 0,
    justifyContent: "center",
    outline: "none",
    paddingInline: tokens.space3,
    position: "relative",
    transitionDuration: tokens.durationControl,
    transitionProperty: "color, background-color",
    zIndex: 1,
    ":focus-visible": {
      boxShadow: tokens.buttonFocusShadow,
    },
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },
  active: { color: tokens.foreground },
  indicator: {
    backgroundColor: tokens.foreground,
    borderRadius: tokens.radiusFull,
    bottom: 0,
    height: 2,
    left: 0,
    position: "absolute",
    transform: "translateX(var(--active-tab-left))",
    transitionDuration: tokens.durationFast,
    transitionProperty: "transform, width",
    transitionTimingFunction: tokens.easeSmoothOut,
    width: "var(--active-tab-width)",
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },
  content: {
    minWidth: 0,
    paddingBlockStart: tokens.space6,
    outline: "none",
    ":focus-visible": {
      boxShadow: tokens.buttonFocusShadow,
    },
  },
});

function Tabs({ className, styleX, ...props }: WithStyleX<TabsPrimitive.Root.Props>) {
  return <TabsPrimitive.Root {...stylexProps([styles.root, styleX], className)} {...props} />;
}

function TabsList({ className, styleX, ...props }: WithStyleX<TabsPrimitive.List.Props>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      {...stylexProps([styles.list, styleX], className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, styleX, ...props }: WithStyleX<TabsPrimitive.Tab.Props>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      {...stateStylexProps((state) => {
        return [styles.trigger, state.active && styles.active, styleX];
      }, className)}
      {...props}
    />
  );
}

function TabsIndicator({ className, styleX, ...props }: WithStyleX<TabsPrimitive.Indicator.Props>) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      {...stylexProps([styles.indicator, styleX], className)}
      {...props}
    />
  );
}

function TabsContent({ className, styleX, ...props }: WithStyleX<TabsPrimitive.Panel.Props>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      {...stylexProps([styles.content, styleX], className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger };

import { stylexProps, type WithStyleX } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const LastItemContext = React.createContext(false);

const styles = stylex.create({
  timeline: { display: "grid", listStyle: "none", padding: 0, margin: 0 },
  item: {
    display: "grid",
    gap: tokens.space3,
    gridTemplateColumns: "1.25rem 1fr",
    paddingBottom: tokens.space5,
    position: "relative",
  },
  lastItem: { paddingBottom: 0 },
  rail: {
    backgroundColor: tokens.border,
    bottom: 0,
    left: "0.59375rem",
    position: "absolute",
    top: "1.25rem",
    width: 1,
  },
  hidden: { display: "none" },
  dot: {
    alignSelf: "start",
    backgroundColor: tokens.mutedForeground,
    borderColor: tokens.background,
    borderRadius: tokens.radiusFull,
    borderStyle: "solid",
    borderWidth: 2,
    boxShadow: tokens.borderShadow,
    height: "0.75rem",
    justifySelf: "center",
    marginTop: tokens.space1_5,
    position: "relative",
    width: "0.75rem",
  },
  content: { fontSize: tokens.fontSizeSm, minWidth: 0 },
  date: { color: tokens.mutedForeground, fontSize: tokens.fontSizeXs },
});

type TimelineItemProps = WithStyleX<React.ComponentProps<"li">> & {
  isLast?: boolean;
};

function Timeline({
  className,
  children,
  styleX,
  ...props
}: WithStyleX<React.ComponentProps<"ol">>) {
  const items = React.Children.toArray(children);

  return (
    <ol
      role="list"
      data-slot="timeline"
      {...stylexProps([styles.timeline, styleX], className)}
      {...props}
    >
      {items.map((child, index) =>
        React.isValidElement<TimelineItemProps>(child) && child.type === TimelineItem
          ? React.cloneElement(child, { isLast: index === items.length - 1 })
          : child,
      )}
    </ol>
  );
}

function TimelineItem({
  className,
  children,
  isLast = false,
  styleX,
  ...props
}: TimelineItemProps) {
  return (
    <LastItemContext.Provider value={isLast}>
      <li
        role="listitem"
        data-slot="timeline-item"
        {...stylexProps([styles.item, isLast && styles.lastItem, styleX], className)}
        {...props}
      >
        {children}
      </li>
    </LastItemContext.Provider>
  );
}

function TimelineRail({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"span">>) {
  const isLast = React.useContext(LastItemContext);

  return (
    <span
      aria-hidden="true"
      data-slot="timeline-rail"
      {...stylexProps([styles.rail, isLast && styles.hidden, styleX], className)}
      {...props}
    />
  );
}

function TimelineDot({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"span">>) {
  return (
    <span
      aria-hidden="true"
      data-slot="timeline-dot"
      {...stylexProps([styles.dot, styleX], className)}
      {...props}
    />
  );
}

function TimelineContent({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"div">>) {
  return (
    <div
      data-slot="timeline-content"
      {...stylexProps([styles.content, styleX], className)}
      {...props}
    />
  );
}

function TimelineDate({ className, styleX, ...props }: WithStyleX<React.ComponentProps<"time">>) {
  return (
    <time data-slot="timeline-date" {...stylexProps([styles.date, styleX], className)} {...props} />
  );
}

export { Timeline, TimelineContent, TimelineDate, TimelineDot, TimelineItem, TimelineRail };

export type { TimelineItemProps };

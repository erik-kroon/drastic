import type { Ref, ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  frame: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: tokens.archivePreviewHeight,
    backgroundColor: tokens.rowDivider,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.input,
    borderRadius: tokens.radiusSm,
    overflow: "hidden",
  },
  compact: { width: 96, height: 128, flexShrink: 0, backgroundColor: tokens.card },
  page: {
    backgroundColor: tokens.card,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.input,
    maxWidth: "100%",
  },
  dimensions: (width: number, height: number) => ({ width, height }),
});

export function DocumentThumbnail(props: {
  canvasRef: Ref<HTMLCanvasElement>;
  width: number;
  height: number;
  label: string;
  children?: ReactNode;
  compact?: boolean;
  busy?: boolean;
}) {
  return (
    <div {...stylex.props(styles.frame, props.compact && styles.compact)}>
      <canvas
        ref={props.canvasRef}
        role="img"
        aria-busy={props.busy ?? false}
        aria-label={props.label}
        {...stylex.props(styles.page, styles.dimensions(props.width, props.height))}
      />
      {props.children}
    </div>
  );
}

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
}) {
  return (
    <div {...stylex.props(styles.frame)}>
      <canvas
        ref={props.canvasRef}
        role="img"
        aria-label={props.label}
        {...stylex.props(styles.page, styles.dimensions(props.width, props.height))}
      />
      {props.children}
    </div>
  );
}

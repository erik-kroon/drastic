import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

export type SourceRegion = { readonly scale: 1000000000; readonly polygon: ReadonlyArray<number> };

const styles = stylex.create({
  overlay: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    mixBlendMode: "multiply",
  },
  region: { fill: tokens.reviewSourceHighlight },
});

export function SourceHighlight(props: {
  region: SourceRegion;
  label: string;
  width?: number;
  height?: number;
}) {
  const width = props.width ?? 1;
  const height = props.height ?? 1;

  const points = props.region.polygon.reduce<string[]>((pairs, point, index, polygon) => {
    if (index % 2 === 0)
      pairs.push(
        `${(point / props.region.scale) * width},${(polygon[index + 1]! / props.region.scale) * height}`,
      );

    return pairs;
  }, []);

  return (
    <svg
      role="img"
      aria-label={props.label}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={props.width ? "xMidYMid meet" : "none"}
      {...stylex.props(styles.overlay)}
    >
      <polygon points={points.join(" ")} {...stylex.props(styles.region)} />
    </svg>
  );
}

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { stateStylexProps, type WithStyleX } from "@open-erp/ui/lib/stylex";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";

const styles = stylex.create({
  root: {
    backgroundColor: tokens.border,
    flexShrink: 0,
  },
  horizontal: {
    height: 1,
    width: "100%",
  },
  vertical: {
    alignSelf: "stretch",
    width: 1,
  },
});

type SeparatorProps = WithStyleX<SeparatorPrimitive.Props>;

function Separator({ className, orientation = "horizontal", styleX, ...props }: SeparatorProps) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      {...stateStylexProps(
        () => [
          styles.root,
          orientation === "horizontal" ? styles.horizontal : styles.vertical,
          styleX,
        ],
        className,
      )}
      {...props}
    />
  );
}

export { Separator };

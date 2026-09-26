import * as stylex from "@stylexjs/stylex";
import type { CSSProperties } from "react";

export type StyleXStyles = stylex.StyleXArray<
  | boolean
  | null
  | undefined
  | stylex.CompiledStyles
  | Readonly<[stylex.CompiledStyles, stylex.InlineStyles]>
>;

export type WithStyleX<Props> = Props extends unknown
  ? Omit<Props, "style"> & { styleX?: StyleXStyles }
  : never;

type ComposedStyleProps<ClassName> = {
  className: ClassName;
  style?: CSSProperties;
};

export function stylexProps(
  styles: ReadonlyArray<StyleXStyles | false | null | undefined>,
  className?: string,
  inlineStyle?: CSSProperties,
): ComposedStyleProps<string | undefined>;
export function stylexProps<State>(
  styles: ReadonlyArray<StyleXStyles | false | null | undefined>,
  className: (state: State) => string | undefined,
  inlineStyle?: CSSProperties,
): ComposedStyleProps<(state: State) => string | undefined>;
export function stylexProps<State>(
  styles: ReadonlyArray<StyleXStyles | false | null | undefined>,
  className?: string | ((state: State) => string | undefined),
  inlineStyle?: CSSProperties,
): ComposedStyleProps<string | undefined | ((state: State) => string | undefined)>;
export function stylexProps<State>(
  styles: ReadonlyArray<StyleXStyles | false | null | undefined>,
  className?: string | ((state: State) => string | undefined),
  inlineStyle?: CSSProperties,
): ComposedStyleProps<string | undefined | ((state: State) => string | undefined)> {
  const compiled = stylex.props(...styles);

  const merge = (custom?: string) =>
    [compiled.className, custom].filter(Boolean).join(" ") || undefined;

  const composed = {
    ...compiled,
    className:
      typeof className === "function"
        ? (state: State) => merge(className(state))
        : merge(className),
  };

  if (inlineStyle === undefined) return composed;

  return { ...composed, style: { ...compiled.style, ...inlineStyle } };
}

export function stateStylexProps<State>(
  styles: (state: State) => ReadonlyArray<StyleXStyles | false | null | undefined>,
  className?: string | ((state: State) => string | undefined),
  inlineStyle?: CSSProperties,
) {
  return {
    className: (state: State) =>
      stylexProps(styles(state), typeof className === "function" ? className(state) : className)
        .className,
    style: (state: State) => stylexProps(styles(state), undefined, inlineStyle).style,
  };
}

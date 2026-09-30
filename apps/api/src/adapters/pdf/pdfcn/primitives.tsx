// Adapted from pdfcn's Takumi primitives (MIT); see LICENSE and UPSTREAM.md.
import type { CSSProperties, ReactNode } from "react";

export type Style = CSSProperties;

export type PdfComponentProps = {
  children?: ReactNode;
  style?: Style | ReadonlyArray<Style>;
};

export const pointToCssPixel = (value: number) => (value * 96) / 72;

const pointLengths = new Set([
  "borderBottomWidth",
  "borderTopWidth",
  "borderWidth",
  "borderRadius",
  "columnGap",
  "fontSize",
  "gap",
  "height",
  "letterSpacing",
  "margin",
  "marginBlock",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginTop",
  "padding",
  "paddingBlock",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "rowGap",
  "width",
  "maxWidth",
  "minWidth",
]);

function numeric(value: unknown): value is number {
  return typeof value === "number";
}

function isStyleList(style: PdfComponentProps["style"]): style is ReadonlyArray<Style> {
  return Array.isArray(style);
}

export function componentStyles(style: PdfComponentProps["style"]): ReadonlyArray<Style> {
  return isStyleList(style) ? style : [style ?? {}];
}

function flatten(style: PdfComponentProps["style"]): Style {
  const merged: Style = Object.assign({}, ...componentStyles(style));

  return Object.fromEntries(
    Object.entries(merged).map(([property, value]) => [
      property,
      numeric(value) && pointLengths.has(property) ? pointToCssPixel(value) : value,
    ]),
  );
}

export function View(props: PdfComponentProps & { wrap?: boolean }) {
  const style: Style = {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    ...flatten(props.style),
  };

  if (props.wrap === false) style.breakInside = "avoid";

  return <div style={style}>{props.children}</div>;
}

export function PdfText(props: PdfComponentProps) {
  return <span style={flatten(props.style)}>{props.children}</span>;
}

export function Document(props: PdfComponentProps & { title: string }) {
  return (
    <div data-pdf-document={props.title} style={flatten(props.style)}>
      {props.children}
    </div>
  );
}

export function Page(props: PdfComponentProps) {
  return (
    <div data-pdf-page style={flatten(props.style)}>
      {props.children}
    </div>
  );
}

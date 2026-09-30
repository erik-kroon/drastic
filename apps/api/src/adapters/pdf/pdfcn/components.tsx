// Adapted from pdfcn components (MIT); see LICENSE and UPSTREAM.md.
import { Children, cloneElement, isValidElement } from "react";
import type { ReactNode } from "react";
import { PageNumber, TotalPages } from "takumi-pdf";
import { PdfText, View, componentStyles, type PdfComponentProps, type Style } from "./primitives";
import { pdfcnTheme as theme } from "./theme";

type TextProps = PdfComponentProps & {
  variant?: "xs" | "sm" | "base" | "xl";
  weight?: "normal" | "semibold";
  align?: "left" | "center" | "right";
  muted?: boolean;
  noMargin?: boolean;
};

export function Text(props: TextProps) {
  const sizes = {
    xs: theme.typography.caption,
    sm: theme.typography.small,
    base: theme.typography.body,
    xl: theme.typography.heading,
  };

  const style: Style = {
    color: props.muted ? theme.colors.mutedForeground : theme.colors.foreground,
    fontFamily: theme.typography.fontFamily,
    fontSize: sizes[props.variant ?? "base"],
    fontWeight: props.weight === "semibold" ? theme.typography.semibold : theme.typography.regular,
    lineHeight: theme.typography.lineHeight,
    marginBottom: props.noMargin ? 0 : theme.spacing.paragraph,
    textAlign: props.align ?? "left",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  };

  return <PdfText style={[style, ...componentStyles(props.style)]}>{props.children}</PdfText>;
}

export function Section(
  props: PdfComponentProps & { noWrap?: boolean; spacing?: "none" | "sm" | "md" },
) {
  const spacing = { none: 0, sm: theme.spacing.paragraph, md: theme.spacing.section };

  return (
    <View
      wrap={!props.noWrap}
      style={[{ marginBlock: spacing[props.spacing ?? "md"] }, ...componentStyles(props.style)]}
    >
      {props.children}
    </View>
  );
}

export function PageHeader(props: {
  title: string;
  subtitle: string;
  rightText: string;
  rightSubText: string;
}) {
  return (
    <View
      wrap={false}
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: theme.spacing.section,
        borderBottom: `${theme.spacing.rule}pt solid ${theme.colors.border}`,
        paddingBottom: theme.spacing.section,
      }}
    >
      <View style={{ width: "65%" }}>
        <Text variant="xl" weight="semibold">
          {props.title}
        </Text>
        <Text variant="sm" muted noMargin>
          {props.subtitle}
        </Text>
      </View>
      <View style={{ width: "35%" }}>
        <Text weight="semibold" align="right">
          {props.rightText}
        </Text>
        <Text variant="sm" muted align="right" noMargin>
          {props.rightSubText}
        </Text>
      </View>
    </View>
  );
}

export function PageFooter(props: { leftText: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        borderTop: `${theme.spacing.rule}pt solid ${theme.colors.border}`,
        marginLeft: theme.page.left,
        marginRight: theme.page.right,
        paddingTop: theme.spacing.paragraph,
        gap: theme.spacing.section,
      }}
    >
      <Text variant="xs" muted noMargin style={{ width: "75%" }}>
        {props.leftText}
      </Text>
      <Text variant="xs" muted align="right" noMargin style={{ width: "25%" }}>
        Sida <PageNumber /> av <TotalPages />
      </Text>
    </View>
  );
}

type KeyValueEntry = { key: string; value: string; emphasized?: boolean };

export function KeyValue(props: { items: ReadonlyArray<KeyValueEntry> }) {
  return (
    <View>
      {props.items.map((item) => (
        <View
          key={item.key}
          wrap={false}
          style={{
            flexDirection: "row",
            paddingBlock: theme.spacing.paragraph,
            gap: theme.spacing.paragraph,
          }}
        >
          <Text
            variant="sm"
            muted={!item.emphasized}
            weight={item.emphasized ? "semibold" : "normal"}
            noMargin
            style={{ width: "35%" }}
          >
            {item.key}
          </Text>
          <Text
            weight={item.emphasized ? "semibold" : "normal"}
            align="right"
            noMargin
            style={{ width: "65%" }}
          >
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function Table(props: PdfComponentProps) {
  return <View style={props.style}>{props.children}</View>;
}

export function TableHeader(props: PdfComponentProps) {
  return <View style={props.style}>{props.children}</View>;
}

export function TableBody(props: PdfComponentProps) {
  const children = Children.map(props.children, (child, index) =>
    isValidElement<TableRowProps>(child) && child.type === TableRow
      ? cloneElement(child, { separator: index > 0 })
      : child,
  );

  return <View style={props.style}>{children}</View>;
}

function isText(children: ReactNode): children is string {
  return typeof children === "string";
}

type TableCellProps = PdfComponentProps & {
  header?: boolean;
  align?: "left" | "center" | "right";
  width: string;
};

export function TableCell(props: TableCellProps) {
  const style: Style = {
    width: props.width,
    paddingBlock: theme.spacing.cell,
    paddingRight: theme.spacing.cell,
    overflowWrap: "anywhere",
  };

  return (
    <View style={[style, ...componentStyles(props.style)]}>
      {isText(props.children) ? (
        <Text
          variant={props.header ? "xs" : "sm"}
          weight={props.header ? "semibold" : "normal"}
          align={props.align}
          noMargin
        >
          {props.children}
        </Text>
      ) : (
        props.children
      )}
    </View>
  );
}

type TableRowProps = PdfComponentProps & { header?: boolean; separator?: boolean };

export function TableRow(props: TableRowProps) {
  const children: ReactNode = Children.map(props.children, (child) =>
    isValidElement<TableCellProps>(child) && child.type === TableCell
      ? cloneElement(child, { header: props.header })
      : child,
  );

  return (
    <View
      wrap={false}
      style={[
        {
          flexDirection: "row",
          borderBottom: props.header
            ? `${theme.spacing.rule}pt solid ${theme.colors.border}`
            : undefined,
          borderTop: props.separator
            ? `${theme.spacing.rule}pt solid ${theme.colors.border}`
            : undefined,
        },
        ...componentStyles(props.style),
      ]}
    >
      {children}
    </View>
  );
}

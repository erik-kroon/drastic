import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

type ESTreeProperty = Extract<ESTree.Node, { type: "Property" }>;

// Keep the rule strict for every new StyleX file. Existing files stay in this
// explicit migration set until each file moves its design values to tokens.
const spacingProperties = new Set([
  "columnGap",
  "gap",
  "margin",
  "marginBlock",
  "marginBlockEnd",
  "marginBlockStart",
  "marginBottom",
  "marginInline",
  "marginInlineEnd",
  "marginInlineStart",
  "marginLeft",
  "marginRight",
  "marginTop",
  "padding",
  "paddingBlock",
  "paddingBlockEnd",
  "paddingBlockStart",
  "paddingBottom",
  "paddingInline",
  "paddingInlineEnd",
  "paddingInlineStart",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "rowGap",
]);

const colorProperties = new Set([
  "background",
  "backgroundColor",
  "borderBlockColor",
  "borderColor",
  "borderInlineColor",
  "color",
  "fill",
  "outlineColor",
  "stroke",
]);

const tokenProperties = new Set([
  "animationDuration",
  "borderRadius",
  "borderBlockEndStartRadius",
  "borderBlockEndEndRadius",
  "borderBlockStartEndRadius",
  "borderBlockStartStartRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "boxShadow",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "textShadow",
  "transitionDuration",
  "transitionTimingFunction",
]);

const allowedKeywords = new Set([
  "auto",
  "currentColor",
  "inherit",
  "initial",
  "none",
  "transparent",
  "unset",
]);

function propertyName(node: ESTreeProperty): string | null {
  if (node.computed) return null;
  if (node.key.type === "Identifier") return node.key.name;
  if (node.key.type === "Literal" && typeof node.key.value === "string") return node.key.value;
  return null;
}

function literalValue(node: ESTree.Node): string | number | null {
  if (
    node.type === "Literal" &&
    (typeof node.value === "string" || typeof node.value === "number")
  ) {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.raw ?? null;
  }
  return null;
}

function designValues(node: ESTree.Node): Array<{ node: ESTree.Node; value: string | number }> {
  const literal = literalValue(node);
  if (literal !== null) return [{ node, value: literal }];
  if (node.type === "TemplateLiteral") return [{ node, value: "template-literal" }];
  if (node.type === "ObjectExpression") {
    return node.properties.flatMap((property) =>
      property.type === "Property" ? designValues(property.value) : [],
    );
  }
  if (node.type === "ArrayExpression") {
    return node.elements.flatMap((element) => (element === null ? [] : designValues(element)));
  }
  return [];
}

function isInsideStylexCreate(node: ESTree.Node): boolean {
  let current: ESTree.Node | null | undefined = node;
  while (current) {
    if (
      current.type === "CallExpression" &&
      current.callee.type === "MemberExpression" &&
      !current.callee.computed &&
      current.callee.object.type === "Identifier" &&
      current.callee.object.name === "stylex" &&
      current.callee.property.type === "Identifier" &&
      current.callee.property.name === "create"
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isStyleDefinitionKey(node: ESTreeProperty): boolean {
  const object = node.parent;
  if (object?.type !== "ObjectExpression") return false;
  const parent = object.parent;
  return (
    parent?.type === "CallExpression" &&
    parent.arguments[0] === object &&
    parent.callee.type === "MemberExpression" &&
    !parent.callee.computed &&
    parent.callee.object.type === "Identifier" &&
    parent.callee.object.name === "stylex" &&
    parent.callee.property.type === "Identifier" &&
    parent.callee.property.name === "create"
  );
}

function needsToken(name: string, value: string | number): boolean {
  if (typeof value === "number") {
    return tokenProperties.has(name) && value !== 0;
  }
  if (allowedKeywords.has(value)) return false;
  if (spacingProperties.has(name)) return /^-?\d+(?:\.\d+)?(?:px|rem)$/u.test(value);
  if (colorProperties.has(name)) return true;
  if (tokenProperties.has(name)) return true;
  return false;
}

/** Require token references for every design-bearing literal inside StyleX styles. */
export const noHardcodedDesignValuesRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Require design tokens for StyleX design values." },
    messages: {
      useToken:
        "Use a typed token for {{name}}. Add a semantic token when the required decision does not exist.",
    },
  },
  create(context) {
    return {
      Property(node) {
        if (!isInsideStylexCreate(node)) return;
        if (isStyleDefinitionKey(node)) return;
        const name = propertyName(node);
        if (name === null) return;
        for (const value of designValues(node.value)) {
          if (needsToken(name, value.value)) {
            context.report({
              node: value.node,
              messageId: "useToken",
              data: { name },
            });
          }
        }
      },
    };
  },
});

import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

type RuntimeFunction = ESTree.ArrowFunctionExpression | ESTree.Function;

function isGenericUiOrTestFile(filename: string): boolean {
  return (
    /(?:^|\/)packages\/ui\/src\/components\//u.test(filename) ||
    /(?:^|\/)(?:tests?|e2e)\//u.test(filename) ||
    /\.(?:test|spec|vitest)\.[cm]?[jt]sx?$/u.test(filename)
  );
}

function isRuntimeFunction(node: ESTree.Node): node is RuntimeFunction {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression"
  );
}

function isInsideTypeGuard(node: ESTree.Node): boolean {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (isRuntimeFunction(current)) {
      return current.returnType?.typeAnnotation.type === "TSTypePredicate";
    }
    current = current.parent;
  }
  return false;
}

function runtimeFunctionName(node: RuntimeFunction): string | null {
  if ((node.type === "FunctionDeclaration" || node.type === "FunctionExpression") && node.id)
    return node.id.name;
  const parent = node.parent;
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
    return parent.id.name;
  if (parent.type === "MethodDefinition" && parent.key.type === "Identifier")
    return parent.key.name;
  return null;
}

function isInsideBoundaryParser(node: ESTree.Node): boolean {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (isRuntimeFunction(current)) {
      const name = runtimeFunctionName(current);
      return name !== null && /^(?:as|coerce|decode|is|normalize|parse|read|validate)/u.test(name);
    }
    current = current.parent;
  }
  return false;
}

function comparesWithObject(node: ESTree.UnaryExpression): boolean {
  const parent = node.parent;
  if (parent.type !== "BinaryExpression" || !["==", "===", "!=", "!=="].includes(parent.operator))
    return false;
  const other = parent.left === node ? parent.right : parent.left;
  return other.type === "Literal" && other.value === "object";
}

function isPartOfValidatedObjectCheck(node: ESTree.UnaryExpression): boolean {
  let current: ESTree.Node = node.parent;
  while (current.parent?.type === "LogicalExpression") current = current.parent;
  return current !== node.parent;
}

function hasBoundaryOperand(node: ESTree.UnaryExpression): boolean {
  return (
    node.argument.type === "Identifier" &&
    (node.argument.name === "error" || node.argument.name === "value")
  );
}

/** Disallow object-shape gates that use typeof instead of decoding external input. */
export const noRuntimeTypeofRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow typeof object checks; external object values must be decoded at their I/O boundary.",
    },
    messages: {
      runtimeTypeof:
        "A `typeof` object check does not establish a useful contract. Parse input at its I/O boundary.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowInTypeGuards: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allowInTypeGuards: false }],
  },
  create(context) {
    if (isGenericUiOrTestFile(context.filename)) return {};
    return {
      UnaryExpression(node) {
        const option = context.options?.[0];
        const allowInTypeGuards =
          typeof option === "object" &&
          option !== null &&
          !Array.isArray(option) &&
          option.allowInTypeGuards === true;
        if (
          node.operator === "typeof" &&
          comparesWithObject(node) &&
          !isPartOfValidatedObjectCheck(node) &&
          !hasBoundaryOperand(node) &&
          !isInsideBoundaryParser(node) &&
          (!allowInTypeGuards || !isInsideTypeGuard(node))
        ) {
          context.report({ node, messageId: "runtimeTypeof" });
        }
      },
    };
  },
});

import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

function isGenericUiOrTestFile(filename: string): boolean {
  return (
    /(?:^|\/)packages\/ui\/src\/components\//u.test(filename) ||
    /(?:^|\/)apps\/server\/src\/(?:components\/pdf\/|lib\/pdf-)/u.test(filename) ||
    /(?:^|\/)(?:tests?|e2e)\//u.test(filename) ||
    /\.(?:test|spec|vitest)\.[cm]?[jt]sx?$/u.test(filename)
  );
}

const commentOwnerKinds = new Set([
  "ExpressionStatement",
  "PropertyDefinition",
  "ReturnStatement",
  "ThrowStatement",
  "VariableDeclaration",
]);

function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}

function needsSafetyComment(node: TypeAssertion): boolean {
  const annotation = node.typeAnnotation;
  if (annotation.type === "TSAnyKeyword" || annotation.type === "TSUnknownKeyword") return true;
  if (annotation.type === "TSObjectKeyword" || annotation.type === "TSMappedType") return true;
  if (annotation.type !== "TSTypeReference" || annotation.typeName.type !== "Identifier")
    return false;
  return annotation.typeName.name === "Object" || annotation.typeName.name === "Record";
}

function hasSafetyComment(sourceCode: SourceCode, node: TypeAssertion): boolean {
  let current: ESTree.Node = node;
  while (true) {
    if (
      sourceCode
        .getCommentsBefore(current)
        .some((comment) => comment.end <= node.start && /\bSAFETY\s*:/u.test(comment.value))
    ) {
      return true;
    }
    if (commentOwnerKinds.has(current.type) || current.parent.type === "Program") return false;
    current = current.parent;
  }
}

/** Require broad type assertions to state the invariant TypeScript cannot express. */
export const requireSafetyCommentForTypeAssertionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a nearby SAFETY comment for assertions to broad types that erase useful evidence.",
    },
    messages: {
      missingSafetyComment:
        "This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.",
    },
  },
  create(context) {
    if (isGenericUiOrTestFile(context.filename)) return {};
    const checkAssertion = (node: TypeAssertion) => {
      if (
        isConstAssertion(node) ||
        !needsSafetyComment(node) ||
        hasSafetyComment(context.sourceCode, node)
      )
        return;
      context.report({ node, messageId: "missingSafetyComment" });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});

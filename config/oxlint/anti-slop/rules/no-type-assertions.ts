import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { checksProductionSource, projectFilename } from "../shared/source-scope.ts";

// Reduce these counts when a file removes an assertion. New files start at zero.
const legacyAssertionCounts = new Map<string, number>();

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}

/** Ban production type casts while allowing `as const` and test fixtures. */
export const noTypeAssertionsRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow production type assertions that bypass inference or parsing." },
    messages: {
      assertion:
        "Do not cast production values. Parse external input or use inference, satisfies, and owner-provided types.",
    },
  },
  create(context) {
    if (!checksProductionSource(context.filename)) return {};
    let remainingLegacyAssertions =
      legacyAssertionCounts.get(projectFilename(context.filename)) ?? 0;
    const checkAssertion = (node: TypeAssertion) => {
      if (isConstAssertion(node)) return;
      if (remainingLegacyAssertions > 0) {
        remainingLegacyAssertions -= 1;
        return;
      }
      context.report({ node, messageId: "assertion" });
    };
    return { TSAsExpression: checkAssertion, TSTypeAssertion: checkAssertion };
  },
});

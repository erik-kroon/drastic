import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { checksDestructuringSource, projectFilename } from "../shared/source-scope.ts";

// Reduce these counts when a file simplifies a pattern. New files start at zero.
const legacyDestructuringCounts = new Map<string, number>();

type DestructuringPattern = ESTree.ArrayPattern | ESTree.ObjectPattern;

function isOverzealous(node: DestructuringPattern): boolean {
  if (node.type === "ArrayPattern") {
    const elements = node.elements.filter((element) => element !== null);
    return (
      elements.length > 4 ||
      elements.some(
        (element) =>
          element.type === "RestElement" ||
          element.type === "ArrayPattern" ||
          element.type === "ObjectPattern",
      )
    );
  }
  return (
    node.properties.length > 4 ||
    node.properties.some(
      (property) =>
        property.type === "RestElement" ||
        (property.value.type !== "Identifier" && property.value.type !== "AssignmentPattern"),
    )
  );
}

/** Keep destructuring shallow and limited to four bindings. */
export const noOverzealousDestructuringRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow nested, rest-based, or wide destructuring in production code." },
    messages: {
      destructuring:
        "Keep destructuring shallow and limited to four bindings. Use direct property access for the remaining values.",
    },
  },
  create(context) {
    if (!checksDestructuringSource(context.filename)) return {};
    let remainingLegacyPatterns =
      legacyDestructuringCounts.get(projectFilename(context.filename)) ?? 0;
    const checkPattern = (node: DestructuringPattern) => {
      if (!isOverzealous(node)) return;
      if (remainingLegacyPatterns > 0) {
        remainingLegacyPatterns -= 1;
        return;
      }
      context.report({ node, messageId: "destructuring" });
    };
    return { ArrayPattern: checkPattern, ObjectPattern: checkPattern };
  },
});

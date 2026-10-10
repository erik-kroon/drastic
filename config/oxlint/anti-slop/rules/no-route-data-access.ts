import { defineRule } from "@oxlint/plugins";

import type { ESTree, Scope, SourceCode } from "@oxlint/plugins";

function isDataModule(value: string): boolean {
  return value === "@tanstack/react-query" || value === "@/lib/accounting-api";
}

function isUnshadowed(sourceCode: SourceCode, identifier: ESTree.IdentifierReference): boolean {
  let scope: Scope | null = sourceCode.getScope(identifier);

  while (scope !== null) {
    const variable = scope.set.get(identifier.name);

    if (variable !== undefined) return variable.defs.length === 0;

    scope = scope.upper;
  }

  return true;
}

function isGlobalFetch(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  if (callee.type === "Identifier") {
    return callee.name === "fetch" && isUnshadowed(sourceCode, callee);
  }

  if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier") return false;

  if (callee.object.name !== "globalThis" || !isUnshadowed(sourceCode, callee.object)) {
    return false;
  }

  return callee.computed
    ? callee.property.type === "Literal" && callee.property.value === "fetch"
    : callee.property.type === "Identifier" && callee.property.name === "fetch";
}

/** Routes compose owners; queries and HTTP requests belong in those owners. */
export const noRouteDataAccessRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Keep query and accounting data access out of web route composition." },
    messages: {
      dataAccess:
        "Move data access to the owning component or application adapter; keep routes thin.",
    },
  },
  create(context) {
    if (!/(?:^|\/)apps\/web\/src\/routes\//u.test(context.filename.replaceAll("\\", "/"))) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        if (node.importKind === "type" || !isDataModule(node.source.value)) return;

        if (
          node.specifiers.length > 0 &&
          node.specifiers.every(
            (specifier) => specifier.type === "ImportSpecifier" && specifier.importKind === "type",
          )
        ) {
          return;
        }

        context.report({ node, messageId: "dataAccess" });
      },
      ImportExpression(node) {
        if (
          node.source.type === "Literal" &&
          typeof node.source.value === "string" &&
          isDataModule(node.source.value)
        ) {
          context.report({ node, messageId: "dataAccess" });
        }
      },
      CallExpression(node) {
        if (isGlobalFetch(context.sourceCode, node.callee)) {
          context.report({ node, messageId: "dataAccess" });
        }
      },
    };
  },
});

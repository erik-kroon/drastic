import { defineRule } from "@oxlint/plugins";

import type { Context, ESTree } from "@oxlint/plugins";

const forbiddenHooks = new Map([
  ["useCallback", "Let the React compiler manage function memoization."],
  ["useEffect", "Derive the value or use an event handler, query, or keyed boundary."],
  ["useLayoutEffect", "Use a component primitive that owns the layout integration."],
  ["useMemo", "Let the React compiler manage value memoization."],
  ["useSyncExternalStore", "Move the external store integration to an approved library adapter."],
]);

const legacyHookKinds = new Map<string, number>();

function checksFeatureCode(filename: string): boolean {
  return /(?:^|\/)apps\/web\/src\/(?:components|routes)\//u.test(filename);
}

function projectFilename(filename: string): string {
  return filename.replaceAll("\\", "/").match(/(?:^|\/)apps\/web\/src\/(.*)$/u)?.[1] ?? filename;
}

function checkImport(
  context: Context,
  node: ESTree.ImportDeclaration,
  allowedKinds: ReadonlySet<string>,
) {
  if (node.source.value !== "react" && node.source.value !== "@tanstack/react-query") return;
  for (const specifier of node.specifiers) {
    if (specifier.type !== "ImportSpecifier") continue;
    const imported =
      specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
    const guidance = forbiddenHooks.get(imported);
    if (guidance === undefined) continue;
    if (allowedKinds.has(imported)) continue;
    context.report({
      node: specifier,
      messageId: "forbiddenHook",
      data: { hook: imported, guidance },
    });
  }
}

/** Keep effects and manual memoization in their owning adapters. */
export const noFeatureReactHooksRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow unmanaged effects, manual memoization, and external store adapters in feature code.",
    },
    messages: { forbiddenHook: "{{hook}} is not permitted in feature code. {{guidance}}" },
  },
  create(context) {
    if (!checksFeatureCode(context.filename)) return {};
    const baseline = legacyHookKinds.get(projectFilename(context.filename)) ?? 0;
    const importedKinds = new Set<string>();
    for (const statement of context.sourceCode.ast.body) {
      if (statement.type !== "ImportDeclaration") continue;
      for (const specifier of statement.specifiers) {
        if (specifier.type !== "ImportSpecifier") continue;
        const imported =
          specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : specifier.imported.value;
        if (forbiddenHooks.has(imported)) importedKinds.add(imported);
      }
    }
    const allowedKinds = new Set([...importedKinds].slice(0, baseline));
    return {
      ImportDeclaration(node) {
        checkImport(context, node, allowedKinds);
      },
    };
  },
});

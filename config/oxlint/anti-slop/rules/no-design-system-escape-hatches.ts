import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const LEGACY_FILES = new Set(["routes/__root.tsx"]);

function webSourcePath(filename: string): string | null {
  const normalized = filename.replaceAll("\\", "/");
  return normalized.match(/(?:^|\/)apps\/web\/src\/(.*)$/u)?.[1] ?? null;
}

function stylexMethod(node: ESTree.CallExpression): string | null {
  if (node.callee.type !== "MemberExpression" || node.callee.computed) return null;
  if (node.callee.object.type !== "Identifier" || node.callee.object.name !== "stylex") return null;
  return node.callee.property.type === "Identifier" ? node.callee.property.name : null;
}

/** Keep new web code inside typed owned components instead of open styling APIs. */
export const noDesignSystemEscapeHatchesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow open StyleX and DOM styling surfaces in new web files.",
    },
    messages: {
      rawAttribute: "Use typed component props instead of the {{name}} styling escape hatch.",
      rawStylex: "Use Box or another owned component instead of stylex.{{name}} in product code.",
    },
  },
  create(context) {
    const sourcePath = webSourcePath(context.filename);
    if (sourcePath === null || LEGACY_FILES.has(sourcePath)) return {};
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier") return;
        if (node.name.name === "className" || node.name.name === "style") {
          context.report({
            node,
            messageId: "rawAttribute",
            data: { name: node.name.name },
          });
        }
      },
      CallExpression(node) {
        const method = stylexMethod(node);
        if (method === "create" || method === "props") {
          context.report({
            node,
            messageId: "rawStylex",
            data: { name: method },
          });
        }
      },
    };
  },
});

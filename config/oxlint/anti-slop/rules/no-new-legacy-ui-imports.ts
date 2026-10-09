import { defineRule } from "@oxlint/plugins";
import { readFileSync } from "node:fs";
import type { ESTree } from "@oxlint/plugins";

const inventory = JSON.parse(
  readFileSync(new URL("../../../../docs/design/legacy-ui-imports.json", import.meta.url), "utf8"),
);

const allowed = new Set<string>(inventory.imports);

export const noNewLegacyUiImportsRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Prevent new legacy UI callers during the kanon migration." },
    messages: {
      legacy: "Use kanon parts. This file/module pair is not in the shrinking legacy inventory.",
    },
  },
  create(context) {
    const filename = context.filename
      .replaceAll("\\", "/")
      .match(/(?:^|\/)(apps\/web\/src\/.*)$/u)?.[1];

    if (!filename) return {};

    const inspect = (node: ESTree.Node, value: string) => {
      if (
        value.startsWith("@open-erp/ui/components/") &&
        !inventory.infrastructureModules.includes(value) &&
        !allowed.has(`${filename}:${value}`)
      ) {
        context.report({ node, messageId: "legacy" });
      }
    };

    return {
      Literal(node) {
        if (typeof node.value === "string") inspect(node, node.value);
      },
      TemplateLiteral(node) {
        const value = node.quasis[0]?.value.cooked;

        if (value) inspect(node, value);
      },
    };
  },
});

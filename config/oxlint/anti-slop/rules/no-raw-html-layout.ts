import { defineRule } from "@oxlint/plugins";

const LAYOUT_ELEMENTS = new Set([
  "article",
  "aside",
  "div",
  "footer",
  "header",
  "li",
  "main",
  "nav",
  "ol",
  "section",
  "ul",
]);

const LEGACY_FILES = new Set(["routes/__root.tsx"]);

function webSourcePath(filename: string): string | null {
  const normalized = filename.replaceAll("\\", "/");
  return normalized.match(/(?:^|\/)apps\/web\/src\/(.*)$/u)?.[1] ?? null;
}

/** Require the closed Box vocabulary for layout elements in new web files. */
export const noRawHtmlLayoutRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow raw HTML layout elements outside the web migration set.",
    },
    messages: {
      rawLayout:
        "Use <Box /> from @open-erp/ui/components/box with an explicit as prop when semantics require it.",
    },
  },
  create(context) {
    const sourcePath = webSourcePath(context.filename);
    if (sourcePath === null || LEGACY_FILES.has(sourcePath)) return {};
    return {
      JSXOpeningElement(node) {
        if (node.name.type === "JSXIdentifier" && LAYOUT_ELEMENTS.has(node.name.name)) {
          context.report({ node, messageId: "rawLayout" });
        }
      },
    };
  },
});

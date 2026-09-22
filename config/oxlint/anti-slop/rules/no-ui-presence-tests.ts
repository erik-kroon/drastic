import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const STRING_PRESENCE_MATCHERS = new Set(["toContain", "toMatch"]);
const RAW_MARKUP_MEMBERS = new Set(["innerHTML", "outerHTML"]);

function isUiTest(filename: string): boolean {
  return (
    /(?:^|\/)(?:apps\/web|packages\/ui)\/tests\//u.test(filename) &&
    /\.(?:test|spec|vitest)\.[cm]?[jt]sx?$/u.test(filename)
  );
}

function memberName(expression: ESTree.MemberExpression): string | null {
  if (expression.computed) {
    return expression.property.type === "Literal" && typeof expression.property.value === "string"
      ? expression.property.value
      : null;
  }
  return expression.property.type === "Identifier" ? expression.property.name : null;
}

function isStringPresenceAssertion(node: ESTree.CallExpression): boolean {
  if (!("property" in node.callee) || !("object" in node.callee) || !("computed" in node.callee)) {
    return false;
  }
  const matcher = memberName(node.callee);
  if (matcher === null || !STRING_PRESENCE_MATCHERS.has(matcher)) return false;
  const expectation = node.callee.object;
  return (
    expectation.type === "CallExpression" &&
    expectation.callee.type === "Identifier" &&
    expectation.callee.name === "expect" &&
    expectation.arguments[0]?.type === "Identifier" &&
    /^(?:markup|source)$/u.test(expectation.arguments[0].name)
  );
}

/** Ban string-presence checks as proof of UI behavior. */
export const noUiPresenceTestsRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow UI tests that only search rendered markup or source strings." },
    messages: {
      presenceOnly:
        "Test the rendered UI through roles, labels, state, or interaction instead of searching an HTML or source string.",
    },
  },
  create(context) {
    if (!isUiTest(context.filename)) return {};
    return {
      CallExpression(node) {
        if (isStringPresenceAssertion(node)) context.report({ node, messageId: "presenceOnly" });
      },
      ImportDeclaration(node) {
        if (node.source.value === "react-dom/server") {
          context.report({ node, messageId: "presenceOnly" });
        }
      },
      MemberExpression(node) {
        const name = memberName(node);
        if (name !== null && RAW_MARKUP_MEMBERS.has(name)) {
          context.report({ node, messageId: "presenceOnly" });
        }
      },
    };
  },
});

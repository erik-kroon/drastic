import { defineRule } from "@oxlint/plugins";

const MAX_COMMENT_LINES = 5;
const EXEMPT_COMMENT_PREFIX = /^(?:\*|!|\s*(?:eslint|oxlint|oxfmt|@license|copyright)\b)/iu;

function isSourceFile(filename: string): boolean {
  return (
    /\.[cm]?[jt]sx?$/u.test(filename) &&
    !/(?:^|\/)packages\/ui\/src\/components\//u.test(filename) &&
    !/(?:^|\/)(?:tests?|e2e|migrations?|generated|vendor)(?:\/|$)/u.test(filename) &&
    !/\.(?:test|spec|vitest|d)\.[cm]?[jt]sx?$/u.test(filename)
  );
}

/** Keep implementation comments short. Long contracts belong in names, types, tests, or docs. */
export const noLongCommentsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow long implementation comments in source files." },
    messages: {
      longComment:
        "Replace this long implementation comment with clear code, types, a focused test, or linked documentation.",
    },
  },
  create(context) {
    if (!isSourceFile(context.filename)) return {};

    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang" || EXEMPT_COMMENT_PREFIX.test(comment.value)) continue;
          const location = context.sourceCode.getLoc(comment);
          if (location.end.line - location.start.line + 1 <= MAX_COMMENT_LINES) continue;
          context.report({ loc: location, messageId: "longComment" });
        }
      },
    };
  },
});

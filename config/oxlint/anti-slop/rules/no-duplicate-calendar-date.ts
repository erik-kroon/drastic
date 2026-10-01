import { defineRule } from "@oxlint/plugins";

const owners = new Map([
  ["packages/domain/src/values.ts", "parsed.toISOString().slice(0,10)===value"],
  [
    "apps/api/src/application/payroll/calculations.ts",
    "period.endsOn===last.toISOString().slice(0,10)",
  ],
  ["apps/api/src/application/vat/actual-return.ts", "start.toISOString().slice(0,10)===endsOn"],
]);

/** One calendar validator and two month-end calculations; no new round-trip copies. */
export const noDuplicateCalendarDateRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Keep real-calendar validation in the domain date owner." },
    messages: {
      duplicate:
        "Use CalendarDate or isCalendarDate from the domain values owner instead of another calendar-date round trip.",
    },
  },
  create(context) {
    if (
      !/(?:^|\/)(?:apps\/(?:api|web)|packages\/[^/]+|jurisdictions\/se)\/src\//u.test(
        context.filename,
      )
    )
      return {};
    const owner = [...owners].find(([path]) => context.filename.endsWith(`/${path}`));
    let comparisons = 0;

    return {
      BinaryExpression(node) {
        if (!["===", "!==", "==", "!="].includes(node.operator)) return;
        const text = context.sourceCode.getText(node).replace(/\s/gu, "");

        if (!text.includes(".toISOString().slice(0,10)")) return;
        comparisons += 1;

        if (owner !== undefined && text === owner[1] && comparisons === 1) return;
        context.report({ node, messageId: "duplicate" });
      },
    };
  },
});

import * as D from "@open-erp/domain/decisions";
import * as Contract from "@open-erp/contracts/decisions";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import { withBook, decode, toJsonObject } from "../commerce/support";
import { digest } from "../json";

export const getDecisionQuestionCatalog = Effect.fn("decisionQuestions.catalog")(function* (
  token: string,
  command: { scope: typeof Accounting.Scope.Type },
) {
  return yield* withBook(token, command.scope, false, function* () {
    const releases = [];

    for (const definition of [D.documentKindDefinition, D.structuredDocumentKindDefinition]) {
      const question = definition.question;

      const release = {
        ...definition,
        digest: yield* digest(definition),
        optionSetDigest: yield* digest({
          type: question.type,
          criteria: question.type === "noul" ? (question.criteria ?? null) : question.criteria,
        }),
      };

      releases.push(release);
    }

    return yield* decode(
      Contract.DecisionQuestionCatalog,
      yield* toJsonObject({ scope: command.scope, releases, limits: D.limits }),
    );
  });
});

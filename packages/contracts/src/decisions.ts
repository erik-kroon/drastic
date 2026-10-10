import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as D from "@open-erp/domain/decisions";
import * as A from "./accounting";
import { accountingErrors } from "./accounting-errors";

export {
  SystemOneRequest,
  SystemOneResponse,
  Question,
  Answer,
  Statistics,
} from "@open-erp/domain/decisions";

export const DecisionQuestionRelease = Schema.Struct({
  ...D.QuestionDefinition.fields,
  digest: A.Digest,
  optionSetDigest: A.Digest,
});

export const DecisionQuestionCatalog = Schema.Struct({
  scope: A.Scope,
  releases: Schema.Array(DecisionQuestionRelease),
  limits: Schema.Struct({
    maxQuestions: Schema.Literal(64),
    maxChoiceOptions: Schema.Literal(255),
    minScoreLevels: Schema.Literal(2),
    maxScoreLevels: Schema.Literal(10),
    probabilityTolerance: Schema.Literal(0.000001),
    consistencyTolerance: Schema.Literal(0.000000000001),
  }),
});

export const DecisionResultView = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  subject: Schema.Struct({ owner: Schema.String, id: Schema.String, revision: Schema.String }),
  question: Schema.Struct({ id: A.Identifier, version: Schema.String, digest: A.Digest }),
  inputDigest: A.Digest,
  optionSetDigest: A.Digest,
  modelRelease: Schema.String,
  requestedModel: Schema.String,
  status: Schema.Literal("unreviewed_source_claim"),
  answer: D.Answer,
  fullDistribution: Schema.Record(Schema.String, D.Probability),
  statistics: D.Statistics,
});

export const DecisionQuestionsApi = HttpApiGroup.make("decisionQuestions").add(
  HttpApiEndpoint.get(
    "getDecisionQuestionCatalog",
    "/v1/entities/:entityId/books/:bookId/automation/decision-questions",
    {
      params: A.Scope,
      success: DecisionQuestionCatalog,
      error: accountingErrors,
    },
  ),
);

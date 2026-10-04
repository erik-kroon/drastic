import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as A from "./accounting";
import * as Sie from "./sie-import";
import { accountingErrors } from "./accounting-errors";

export const SaveOnboardingMapping = Schema.Struct({
  previewId: A.Identifier,
  expectedPreviewDigest: A.Digest,
  sourceAccount: Sie.Mapping.fields.sourceAccount,
  accountId: A.Identifier,
  remember: Schema.Boolean,
  expectedRevision: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2147483646 })),
});

export const OnboardingMapping = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  previewId: A.Identifier,
  previewDigest: A.Digest,
  occurrenceId: A.Identifier,
  sourceSystem: Schema.String,
  sourceAccountId: Schema.String,
  sourceAccount: Sie.Mapping.fields.sourceAccount,
  accountId: A.Identifier,
  remember: Schema.Boolean,
  revision: Schema.Int,
  actorId: A.Identifier,
  chosenAt: Schema.String,
  kind: Schema.Literal("reviewed_source_account_mapping_v1"),
});

export const OnboardingMappings = Schema.Struct({
  scope: A.Scope,
  previewId: A.Identifier,
  current: Schema.Array(OnboardingMapping),
  history: Schema.Array(OnboardingMapping),
  proposedDefaults: Schema.Array(Sie.Mapping),
});

const path = "/v1/entities/:entityId/books/:bookId/onboarding/account-mappings";

const scoped = { params: A.Scope, error: accountingErrors };

export const OnboardingMappingsApi = HttpApiGroup.make("onboardingMappings")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.post("saveOnboardingMapping", path, {
      ...scoped,
      headers: A.IdempotencyHeaders,
      payload: SaveOnboardingMapping,
      success: OnboardingMapping,
    }),
    HttpApiEndpoint.get("getOnboardingMappings", path, {
      ...scoped,
      query: Schema.Struct({ previewId: A.Identifier }),
      success: OnboardingMappings,
    }),
  );

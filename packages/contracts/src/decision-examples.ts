import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as A from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { DecisionClassification } from "./decision-provenance";
import * as Memory from "@open-erp/domain/firm-memory";
import * as Consequence from "@open-erp/domain/treatment-consequence";

const DecisionKey = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));

export const SealDecisionExamples = Schema.Struct({
  purpose: Schema.Literals(["evaluation", "training"]),
  selectedDecisionIds: Schema.Array(DecisionKey).check(Schema.isMaxLength(1000)),
});

export const DecisionExample = Schema.Struct({
  decision: Schema.Struct({ owner: Schema.String, id: DecisionKey }),
  subject: Schema.JsonObject,
  originalCommitCutoff: A.MinorUnits,
  stateBuilderVersion: Schema.Literal("retained_snapshot_projection_v1"),
  optionBuilderVersion: Schema.Literal("served_options_projection_v1"),
  state: Schema.JsonObject,
  options: Schema.Struct({
    capture: Schema.Literals(["no_recorded_exposure", "served_options_only", "uncited_exposure"]),
    fullUniverseCaptured: Schema.Literal(false),
    records: Schema.Array(Schema.JsonObject),
  }),
  chosenTreatment: Schema.JsonObject,
  precedent: Schema.optional(Memory.Precedent),
  consequence: Schema.optional(
    Schema.Struct({
      builderVersion: Consequence.BuilderVersion,
      captureStatus: Schema.Literals(["retained_treatments", "not_accounting_treatment"]),
      treatments: Schema.Array(
        Schema.Struct({ capture: Consequence.CapturedTreatment, result: Consequence.Consequence }),
      ),
    }),
  ),
  provenance: Schema.Struct({ classification: DecisionClassification, digest: A.Digest }),
  lineage: Schema.Array(Schema.JsonObject),
  evidence: Schema.Array(Schema.JsonObject),
  missingFacts: Schema.Array(Schema.String),
  digest: A.Digest,
});

export const DecisionExampleExport = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  purpose: SealDecisionExamples.fields.purpose,
  lineageCutoff: A.MinorUnits,
  versions: Schema.Struct({
    schema: Schema.Literals([
      "decision_examples_v1",
      "decision_examples_v2",
      "decision_examples_v3",
    ]),
    memory: Schema.optional(Memory.AlgorithmVersion),
    consequence: Schema.optional(Consequence.BuilderVersion),
    state: Schema.Literal("retained_snapshot_projection_v1"),
    options: Schema.Literal("served_options_projection_v1"),
    lineage: Schema.Literal("posted_voucher_lineage_v1"),
    redaction: Schema.Literal("swedish_personal_id_v1"),
    eligibility: Schema.Literal("independent_corrected_v1"),
  }),
  examples: Schema.Array(DecisionExample),
  exclusions: Schema.Array(
    Schema.Struct({ owner: Schema.String, id: DecisionKey, reason: Schema.String }),
  ),
  manifest: Schema.Struct({
    denominators: Schema.Struct({
      inventory: Schema.Int,
      selected: Schema.Int,
      exported: Schema.Int,
      excluded: Schema.Int,
    }),
    inventory: Schema.Array(
      Schema.Struct({ owner: Schema.String, id: DecisionKey, digest: A.Digest }),
    ),
    lineageInventory: Schema.Array(
      Schema.Struct({ kind: Schema.String, id: DecisionKey, digest: A.Digest }),
    ),
    exclusionCounts: Schema.Record(Schema.String, Schema.Int),
  }),
  digest: A.Digest,
});

const path = "/v1/entities/:entityId/books/:bookId/automation/decision-examples";

export const DecisionExamplesApi = HttpApiGroup.make("decisionExamples")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.post("sealDecisionExamples", path, {
      params: A.Scope,
      headers: A.IdempotencyHeaders,
      payload: SealDecisionExamples,
      success: DecisionExampleExport,
      error: accountingErrors,
    }),
    HttpApiEndpoint.get("getDecisionExamples", `${path}/:id`, {
      params: A.ChangePath,
      success: DecisionExampleExport,
      error: accountingErrors,
    }),
  );

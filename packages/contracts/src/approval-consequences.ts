import * as Schema from "effect/Schema";
import * as A from "./accounting";
import * as Consequence from "@open-erp/domain/treatment-consequence";

export const SourcePostingBindings = Schema.Struct({
  version: Schema.Literal("purchase_journal_order_v1"),
  lines: Schema.Array(
    Schema.Struct({
      sourceLineId: Schema.NullOr(A.Identifier),
      postingLineId: A.Identifier,
      ordinal: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 499 })),
      role: Schema.Literals(["expense", "input_vat", "control"]),
    }),
  ).check(Schema.isMaxLength(500)),
});

export const ApprovalConsequenceCapture = Schema.Struct({
  version: Schema.Literal("approval_consequence_capture_v1"),
  status: Schema.Literals(["captured", "source_bindings_not_captured", "unsupported_profile"]),
  mappingRelease: Schema.Struct({
    id: A.Identifier,
    checksum: A.Digest,
    qualification: Schema.Literal("synthetic_only"),
  }),
  sourceLines: Schema.Array(
    Schema.Struct({
      sourceLineId: A.Identifier,
      postingLineId: A.Identifier,
      capture: Consequence.CapturedTreatment,
    }),
  ).check(Schema.isMaxLength(50)),
});

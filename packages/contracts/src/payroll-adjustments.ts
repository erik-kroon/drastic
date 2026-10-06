import * as Schema from "effect/Schema";
import * as Accounting from "./accounting";
import { EvidenceReference } from "./commerce";

export const AdjustmentInstruction = Schema.Struct({
  id: Accounting.Identifier,
  paidEventId: Accounting.Identifier,
  employeeId: Accounting.Identifier,
  month: Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/)),
  kind: Schema.Literals(["future_pay", "additional_compensation"]),
  signedGrossDeltaMinor: Accounting.SignedMinorUnits,
  netRecovery: Schema.optional(
    Schema.Struct({
      claimId: Accounting.Identifier,
      amountMinor: Accounting.MinorUnits,
      receivableAccountId: Accounting.Identifier,
    }),
  ),
  evidence: EvidenceReference,
  executionId: Accounting.Identifier,
});

export const AdjustmentSnapshot = Schema.Struct({
  ...AdjustmentInstruction.fields,
  digest: Accounting.Digest,
});

import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import { accountingErrors as errors } from "./accounting-errors";

// NEXT-08 owner contract: payment instruction resolution and replacement,
// extending the existing supplier payment-batch/export owner.
//
// A resolution frees instruction capacity after proof that the instruction did
// not execute. It posts no journal, changes no payable allocation and moves no
// money. A replacement compiles a new immutable successor from current
// approved amounts and never edits the old export bytes.
//
// Two things this owner does not do. It does not evaluate the packet's
// controlled-never-dispatched branch, because exclusive channel control over
// exported bytes is not currently evidenced anywhere; only an explicit
// operator-reported rejection is provable here, and anything else leaves
// resubmission unknown rather than permitted. And it does not supply new
// instruction identities: the end-to-end identity is read from the retained
// selection item inside the batch bytes, one instruction per item, never one
// per export. A different key over the same proof is a duplicate economic
// effect and refuses.

export const ResolvePaymentInstruction = Schema.Struct({
  exportId: Accounting.Identifier,
  invoiceId: Accounting.Identifier,
});

export type ResolvePaymentInstruction = typeof ResolvePaymentInstruction.Type;

export const PaymentResolution = Schema.Struct({
  resolutionId: Accounting.Identifier,
  exportId: Accounting.Identifier,
  invoiceId: Accounting.Identifier,
  endToEndId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  originalAmountMinor: Accounting.MinorUnits,
  releasedAmountMinor: Accounting.MinorUnits,
  proofKind: Schema.Literals(["operator_reported_rejection", "none"]),
  proofDigest: Accounting.Digest,
  resubmission: Schema.Literals(["permitted", "blocked", "unknown"]),
  reason: Schema.NullOr(Schema.String),
  supersedes: Schema.NullOr(Accounting.Identifier),
  commandKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
  receipt: Commerce.CommandReceipt,
});

export type PaymentResolution = typeof PaymentResolution.Type;

export const PreparePaymentReplacement = Schema.Struct({
  resolutionKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
  newExportId: Accounting.Identifier,
  invoiceId: Accounting.Identifier,
});

export type PreparePaymentReplacement = typeof PreparePaymentReplacement.Type;

export const PaymentReplacement = Schema.Struct({
  replacementId: Accounting.Identifier,
  newInstructionId: Accounting.Identifier,
  predecessorId: Accounting.Identifier,
  resolutionId: Accounting.Identifier,
  approvedNewDigest: Accounting.Digest,
  compiledAmountMinor: Accounting.MinorUnits,
  beneficiaryRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  receipt: Commerce.CommandReceipt,
});

export type PaymentReplacement = typeof PaymentReplacement.Type;

const path = "/v1/entities/:entityId/books/:bookId/commerce/supplier-payment-resolutions";

export const PaymentResolutionsApi = HttpApiGroup.make("paymentResolutions").add(
  HttpApiEndpoint.post("resolvePaymentInstruction", path, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: ResolvePaymentInstruction.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: PaymentResolution,
    error: errors,
  }),
  HttpApiEndpoint.post("preparePaymentReplacement", `${path}/replacements`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PreparePaymentReplacement.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: PaymentReplacement,
    error: errors,
  }),
);

// Agent surface. Read-only and deliberately narrow: an agent may resolve a
// retained instruction against the retained outcome chain and reach the proof,
// the receipt and the reason a capacity stayed reserved. It may not prove
// no-execution by itself — unknown means unknown — and it may not prepare a
// successor, because a replacement needs a fresh operator-initiated export.
export const PaymentResolutionCapabilities = {
  payments_resolve_instruction: {
    description:
      "Resolve one retained supplier payment instruction per export item against the retained outcome chain: release capacity after proof the instruction did not execute, keep it reserved otherwise, and refuse a settled instruction, a different key over the same proof, or a replacement without an effective release. A resolution posts nothing, allocates nothing and moves no money. An XML file is not a paid invoice, and neither is its resolution.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: ResolvePaymentInstruction,
    }),
    output: PaymentResolution,
    readOnly: true,
  },
};

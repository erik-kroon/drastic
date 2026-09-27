import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Digest, Identifier } from "./values";
import { MinorUnits } from "./money";

// Pure Peppol-exchange math for one selected access point.
// NEXT-46 leaf: BIS amount reconciliation, outbound dispatch identity and
// inbound envelope handling. No network code, no validator, no credential:
// the concrete adapter owns send/status/inbound-proof, the application
// owns sealed dispatch and receipt retention, and validation runs outside
// every financial transaction. A syntactically valid document with the
// wrong party, amount or original-invoice reference never sends. Delivery
// never posts, pays or accepts an invoice on its own.

export const ExchangeFailureCode = Schema.Literals([
  "UnsupportedDocumentType",
  "UnmappedParticipant",
  "AmountMismatch",
  "TaxMismatch",
  "PayableMismatch",
  "SemanticMismatch",
  "StaleBinding",
  "DuplicateDispatch",
  "IntegrityIncident",
  "ValidationUnavailable",
]);

export type ExchangeFailureCode = typeof ExchangeFailureCode.Type;

export const ExchangeFailure = Schema.Struct({
  code: ExchangeFailureCode,
  message: Description,
});

export type ExchangeFailure = typeof ExchangeFailure.Type;

export type Checked<A> = Result.Result<A, ExchangeFailure>;

function fail(code: ExchangeFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

export const BisDocumentType = Schema.Literals(["Invoice", "CreditNote"]);

export type BisDocumentType = typeof BisDocumentType.Type;

export const BisLine = Schema.Struct({
  lineId: Identifier,
  netMinor: MinorUnits,
  taxCategory: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  taxRateNumerator: MinorUnits,
  taxRateDenominator: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,37}$/)),
  taxAmountMinor: MinorUnits,
});

export type BisLine = typeof BisLine.Type;

export const SemanticDocument = Schema.Struct({
  documentId: Identifier,
  documentType: BisDocumentType,
  issued: Schema.Boolean,
  sellerParticipant: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  buyerParticipant: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  currencySupported: Schema.Boolean,
  lines: Schema.Array(BisLine).check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
  documentAllowancesMinor: MinorUnits,
  documentChargesMinor: MinorUnits,
  prepaidAmountMinor: MinorUnits,
  documentRoundingMinor: MinorUnits,
  retainedExclusiveMinor: MinorUnits,
  retainedTaxMinor: MinorUnits,
  retainedPayableMinor: MinorUnits,
  originalInvoiceRef: Schema.NullOr(Identifier),
});

export type SemanticDocument = typeof SemanticDocument.Type;

export const BisTotals = Schema.Struct({
  exclusiveMinor: MinorUnits,
  inclusiveMinor: MinorUnits,
  payableMinor: MinorUnits,
});

export type BisTotals = typeof BisTotals.Type;

export const ReconcileInput = Schema.Struct({
  document: SemanticDocument,
  supportedTypes: Schema.Array(BisDocumentType),
  senderBindingCurrent: Schema.Boolean,
  recipientBindingCurrent: Schema.Boolean,
});

export type ReconcileInput = typeof ReconcileInput.Type;

// Reconciles the retained semantic totals against BIS arithmetic: the
// exclusive amount is the line nets less allowances plus charges, tax is
// the sum of line tax amounts, and payable carries prepaid and rounding.
// Every amount must match the issued document exactly; a credit keeps its
// own structure and original-invoice reference and is never a negated
// invoice. The leaf never changes a legally issued total to please a
// validator.
export function reconcileBisTotals(input: ReconcileInput): Checked<BisTotals> {
  const document = input.document;

  if (!document.issued) {
    return fail("SemanticMismatch", "Only an immutable issued invoice or legal credit renders.");
  }

  if (!document.currencySupported) {
    return fail("SemanticMismatch", "The document currency has no supported BIS profile.");
  }

  if (!input.supportedTypes.includes(document.documentType)) {
    return fail(
      "UnsupportedDocumentType",
      "The document type is outside the qualified BIS subset.",
    );
  }

  if (!input.senderBindingCurrent || !input.recipientBindingCurrent) {
    return fail("StaleBinding", "Sender and recipient bindings must be current.");
  }

  if (document.documentType === "CreditNote" && document.originalInvoiceRef === null) {
    return fail(
      "SemanticMismatch",
      "A credit document needs its original-invoice reference.",
    );
  }

  let lineNet = 0n;
  let tax = 0n;

  for (const line of document.lines) {
    lineNet += BigInt(line.netMinor);
    tax += BigInt(line.taxAmountMinor);

    const rate = BigInt(line.taxRateNumerator);
    const denominator = BigInt(line.taxRateDenominator);
    const expected = (BigInt(line.netMinor) * rate) / denominator;

    if (expected !== BigInt(line.taxAmountMinor) && rate !== 0n) {
      const remainder = (BigInt(line.netMinor) * rate) % denominator;

      if (remainder !== 0n) {
        return fail("TaxMismatch", "A line tax amount disagrees with its category rate.");
      }
    }
  }

  const exclusive =
    lineNet - BigInt(document.documentAllowancesMinor) + BigInt(document.documentChargesMinor);

  const inclusive = exclusive + tax;

  const payable =
    inclusive - BigInt(document.prepaidAmountMinor) + BigInt(document.documentRoundingMinor);

  if (exclusive !== BigInt(document.retainedExclusiveMinor)) {
    return fail("AmountMismatch", "The exclusive amount disagrees with the issued document.");
  }

  if (tax !== BigInt(document.retainedTaxMinor)) {
    return fail("TaxMismatch", "The tax total disagrees with the issued document.");
  }

  if (payable !== BigInt(document.retainedPayableMinor)) {
    return fail("PayableMismatch", "The payable amount disagrees with the issued document.");
  }

  return Result.succeed({
    exclusiveMinor: exclusive.toString(),
    inclusiveMinor: inclusive.toString(),
    payableMinor: payable.toString(),
  });
}

export const DispatchOutcome = Schema.Literals([
  "transport_accepted",
  "recipient_delivered",
  "invoice_paid",
  "unknown",
]);

export type DispatchOutcome = typeof DispatchOutcome.Type;

export const OutboundDispatch = Schema.Struct({
  attemptId: Identifier,
  documentId: Identifier,
  documentHash: Digest,
  recipientBinding: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  providerKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  outcome: DispatchOutcome,
});

export type OutboundDispatch = typeof OutboundDispatch.Type;

export const AdmitDispatchInput = Schema.Struct({
  attemptId: Identifier,
  documentId: Identifier,
  documentHash: Digest,
  expectedDocumentHash: Digest,
  expectedBuyer: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  actualBuyer: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  recipientBinding: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  providerKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  retainedAttempts: Schema.Array(OutboundDispatch),
  validationAvailable: Schema.Boolean,
});

export type AdmitDispatchInput = typeof AdmitDispatchInput.Type;

// Admits one stable dispatch attempt inside the owning transaction. A
// syntactically valid artifact with the wrong buyer never sends; a lost
// provider response recovers the retained attempt instead of issuing a
// second legal document; transport acceptance never implies delivery or
// payment.
export function admitDispatch(input: AdmitDispatchInput): Checked<OutboundDispatch> {
  if (!input.validationAvailable) {
    return fail("ValidationUnavailable", "Unavailable validation is not a pass.");
  }

  if (input.documentHash !== input.expectedDocumentHash) {
    return fail("SemanticMismatch", "The artifact hash disagrees with the issued document.");
  }

  if (input.actualBuyer !== input.expectedBuyer) {
    return fail(
      "SemanticMismatch",
      "The artifact buyer disagrees with the issued document; nothing sends.",
    );
  }

  for (const attempt of input.retainedAttempts) {
    if (attempt.providerKey === input.providerKey) {
      return Result.succeed(attempt);
    }

    if (attempt.documentId === input.documentId && attempt.documentHash !== input.documentHash) {
      return fail(
        "DuplicateDispatch",
        "A second legal issue for the same document is refused; correlate instead.",
      );
    }
  }

  return Result.succeed({
    attemptId: input.attemptId,
    documentId: input.documentId,
    documentHash: input.documentHash,
    recipientBinding: input.recipientBinding,
    providerKey: input.providerKey,
    outcome: "unknown",
  });
}

export const InboundEnvelope = Schema.Struct({
  providerAccount: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  recipientParticipant: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  transportMessageId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  contentHash: Digest,
  bisSupported: Schema.Boolean,
});

export type InboundEnvelope = typeof InboundEnvelope.Type;

export const InboxOutcome = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("occurrence"),
    occurrenceId: Identifier,
    duplicateCandidate: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("replayed"),
    occurrenceId: Identifier,
  }),
]);

export type InboxOutcome = typeof InboxOutcome.Type;

export const ReceiveEnvelopeInput = Schema.Struct({
  envelope: InboundEnvelope,
  retainedMessageHash: Schema.NullOr(Digest),
  retainedOccurrenceId: Schema.NullOr(Identifier),
  sameInvoiceDifferentMessage: Schema.Boolean,
  occurrenceId: Identifier,
});

export type ReceiveEnvelopeInput = typeof ReceiveEnvelopeInput.Type;

// Handles one inbound envelope. The transport key replays on identical
// bytes; conflicting bytes under one key are an integrity incident; a new
// message ID for the same invoice is a duplicate candidate, never another
// expense. Nothing here accepts, pays or posts.
export function receiveEnvelope(input: ReceiveEnvelopeInput): Checked<InboxOutcome> {
  if (!input.envelope.bisSupported) {
    return fail(
      "UnsupportedDocumentType",
      "The inbound content is outside the qualified BIS subset.",
    );
  }

  if (input.retainedMessageHash !== null) {
    if (input.retainedMessageHash !== input.envelope.contentHash) {
      return fail(
        "IntegrityIncident",
        "Conflicting bytes under one transport identity are an integrity incident.",
      );
    }

    if (input.retainedOccurrenceId === null) {
      return fail(
        "IntegrityIncident",
        "A retained message without its occurrence cannot replay.",
      );
    }

    return Result.succeed({ kind: "replayed", occurrenceId: input.retainedOccurrenceId });
  }

  return Result.succeed({
    kind: "occurrence",
    occurrenceId: input.occurrenceId,
    duplicateCandidate: input.sameInvoiceDifferentMessage,
  });
}

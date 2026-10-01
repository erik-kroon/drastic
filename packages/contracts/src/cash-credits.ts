import * as Schema from "effect/Schema";
import * as A from "./accounting";
import * as Commerce from "./commerce";
import * as Profiles from "./company-profiles";
import * as Cash from "@open-erp/domain/cash-method";
import { CommandReceipt } from "./reconciliation";
import { SupplierInvoiceDraftRevision } from "./supplier-invoice-drafts";
import { SupplierLineAssignment } from "./supplier-acceptance";

export const PrepareCashCredit = Schema.Struct({
  invoiceId: A.Identifier,
  draftId: A.Identifier,
  expectedRevision: Commerce.Version,
  expectedDigest: A.Digest,
  accountingPeriodId: A.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  lineMappings: Schema.Array(
    Schema.Struct({
      creditLineId: A.Identifier,
      sourceLineId: A.Identifier,
      treatment: SupplierLineAssignment.fields.treatment,
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  rationale: A.Description,
});

export const CashCreditLine = Schema.Struct({
  lineId: A.Identifier,
  before: Cash.CashMethodLine,
  after: Cash.CashMethodLine,
  creditGrossMinor: A.MinorUnits,
  recognizedCorrectionMinor: A.MinorUnits,
  correctionNetMinor: A.MinorUnits,
  correctionTaxMinor: A.MinorUnits,
  correctionDeductibleMinor: A.MinorUnits,
  originalRecognitionId: Schema.NullOr(A.Identifier),
  originalVatFactId: Schema.NullOr(A.Identifier),
  originalVoucherId: Schema.NullOr(A.Identifier),
  taxJournalIndex: Schema.NullOr(Schema.Int),
});

export const CashCreditSelection = Schema.Struct({
  input: PrepareCashCredit,
  creditDraft: SupplierInvoiceDraftRevision,
  creditDate: A.AccountingDate,
  supplierCreditNumber: A.Description,
  eventId: A.Identifier,
  invoiceRevision: Commerce.Version,
  allocationVersion: A.MinorUnits,
  basis: Schema.JsonObject,
  invoiceEvidence: Commerce.EvidenceReference,
  creditEvidence: Commerce.EvidenceReference,
  methodFactRevisionId: A.Identifier,
  postingWitness: Profiles.ProfileWitness,
  vatWitness: Profiles.ProfileWitness,
  periodVersion: Schema.String,
  profileVersion: Schema.String,
  writerEpoch: Schema.String,
  accounts: Schema.Array(Schema.Struct({ id: A.Identifier, version: Schema.String })),
  lines: Schema.Array(CashCreditLine),
  journal: Cash.CashJournalLines,
});

export const CashCreditPlan = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  selection: CashCreditSelection,
  postingPlan: Schema.NullOr(A.ChangeSet),
  createdBy: A.Identifier,
  createdAt: Schema.String,
  digest: A.Digest,
});

export const ApproveCashCredit = Schema.Struct({ planDigest: A.Digest });

export const ExecuteCashCredit = Schema.Struct({ planDigest: A.Digest, approvalId: A.Identifier });

export const CashCreditApproval = Schema.Struct({
  id: A.Identifier,
  planId: A.Identifier,
  planDigest: A.Digest,
  actorId: A.Identifier,
  expiresAt: Schema.String,
  cashPostingApprovalId: Schema.NullOr(A.Identifier),
  receipt: CommandReceipt,
});

export const CashCreditReceipt = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  invoiceId: A.Identifier,
  planId: A.Identifier,
  approvalId: A.Identifier,
  creditGrossMinor: A.MinorUnits,
  recognizedCorrectionMinor: A.MinorUnits,
  lines: Schema.Array(CashCreditLine),
  postingReceipt: Schema.NullOr(A.ExecutionReceipt),
  vatFactIds: Schema.Array(A.Identifier),
  committedAt: Schema.String,
  receipt: CommandReceipt,
});

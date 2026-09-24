import { firmStatements } from "./statements/firms";
import { vatAmendmentStatements } from "./statements/vat-amendments";
import { expenseTaxWithdrawalStatements } from "./statements/expense-tax-withdrawals";
import { expenseTaxSnapshotStatements } from "./statements/expense-tax-snapshots";
import { subledgerStatements } from "./statements/subledgers";
import { RequestEnvironment } from "../runtime/environment";
import { failure } from "../application/failures";
import * as Accounting from "@open-erp/contracts/accounting";
import { sql, type SQL } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlError from "effect/unstable/sql/SqlError";
import { Database, databaseLayer } from "./connection";
import { sourceIntakeStatements } from "./statements/source-intake";
import { registerReportStatements } from "./statements/register-report";
import { reportComparisonStatements } from "./statements/reports";
import { closingDiscoveryStatements } from "./statements/closing";
import { preparationJobStopStatements } from "./statements/automation";
import { sieStatements } from "./statements/sie";
import { invoiceDraftStatements } from "./statements/invoice-draft";
import { supplierInvoiceDraftStatements } from "./statements/supplier-invoice-drafts";
import { supplierAcceptanceStatements } from "./statements/supplier-acceptance";
import { supplierPaymentBatchStatements } from "./statements/supplier-payment-batches";
import { subledgerControlStatements } from "./statements/subledger-controls";
import { exchangeRateStatements } from "./statements/exchange-rates";
import { invoiceIssuanceStatements } from "./statements/invoice-issuance";
import { invoiceCancellationStatements } from "./statements/invoice-cancellations";
import { invoiceDocumentStatements } from "./statements/invoice-documents";
import { invoicePdfStatements } from "./statements/invoice-pdf";
import { invoicePolicyStatements } from "./statements/invoice-policy";
import { invoiceDeliveryStatements } from "./statements/invoice-delivery";
import { bankConnectorStatements } from "./statements/bank-connector";
import { sieImportStatements } from "./statements/sie-import";
import { commerceAllocationReversalStatements } from "./statements/commerce-allocation-reversals";
import { bankMatchReversalStatements } from "./statements/bank-match-reversals";
import { bankMatchCandidateStatements } from "./statements/bank-match-candidates";
import { bankSourceCoverageStatements } from "./statements/bank-source-coverage";
import { bankSignoffStatements } from "./statements/bank-signoffs";
import { bankInventorySignoffStatements } from "./statements/bank-inventory-signoffs";
import { taxAccountStatements } from "./statements/tax-account";

const PostgresFailure = Schema.Struct({
  code: Schema.String,
  detail: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});

const statements = {
  ...firmStatements,
  ...vatAmendmentStatements,
  ...expenseTaxWithdrawalStatements,
  ...expenseTaxSnapshotStatements,
  ...subledgerStatements,
  workspaceCoordination: (parameters) =>
    sql`select openerp.workspace_coordination(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
  workspaceSaveView: (parameters) =>
    sql`select openerp.workspace_save_view(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  workspaceDeleteView: (parameters) =>
    sql`select openerp.workspace_delete_view(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  workspaceAssignWork: (parameters) =>
    sql`select openerp.workspace_assign_work(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  recordVatFact: (parameters) =>
    sql`select openerp.record_vat_fact(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  vatReturnBasis: (parameters) =>
    sql`select openerp.vat_return_basis(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
  getVatFact: (parameters) =>
    sql`select openerp.get_vat_fact(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  sealVatReturnDraft: (parameters) =>
    sql`select openerp.seal_vat_return_draft(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb,${parameters[4]}::jsonb,${parameters[5]}::jsonb) as result`,
  getVatDraft: (parameters) =>
    sql`select openerp.get_vat_return_draft(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listVatDrafts: (parameters) =>
    sql`select openerp.list_vat_return_drafts(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
  admitPreparationJob: (parameters) =>
    sql`select openerp.admit_preparation_job(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::text) as result`,
  getPreparationJob: (parameters) =>
    sql`select openerp.get_preparation_job(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  pendingPreparationJobs: (parameters) =>
    sql`select openerp.pending_preparation_jobs(${parameters[0]}::text) as result`,
  executePreparationJob: (parameters) =>
    sql`select openerp.execute_preparation_job(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::integer) as result`,
  workspaceAttention: (parameters) =>
    sql`select openerp.workspace_attention(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::jsonb) as result`,
  workspaceListWork: (parameters) =>
    sql`select openerp.workspace_list_work(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::jsonb) as result`,
  ownersCreateOwner: (parameters) =>
    sql`select openerp.owners_create_owner(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  ownersGetOwner: (parameters) =>
    sql`select openerp.owners_get_owner(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  ownersListOwners: (parameters) =>
    sql`select openerp.owners_list_owners(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  ownersCreateRecord: (parameters) =>
    sql`select openerp.owners_create_record(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  ownersReviseRecord: (parameters) =>
    sql`select openerp.owners_revise_record(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  ownersGetRecord: (parameters) =>
    sql`select openerp.owners_get_record(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  ownersListRecords: (parameters) =>
    sql`select openerp.owners_list_records(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  ownersRecordHistory: (parameters) =>
    sql`select openerp.owners_record_history(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
  ownersReviewRecord: (parameters) =>
    sql`select openerp.owners_review_record(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  ownersAttachProposal: (parameters) =>
    sql`select openerp.owners_attach_proposal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  ownersAttachPostedLine: (parameters) =>
    sql`select openerp.owners_attach_posted_line(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  ownersPrepareAllocation: (parameters) =>
    sql`select openerp.owners_prepare_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  ownersGetAllocation: (parameters) =>
    sql`select openerp.owners_get_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  ownersApproveAllocation: (parameters) =>
    sql`select openerp.owners_approve_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  ownersApplyAllocation: (parameters) =>
    sql`select openerp.owners_apply_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  ownersPrepareControl: (parameters) =>
    sql`select openerp.owners_prepare_control(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  ownersGetControl: (parameters) =>
    sql`select openerp.owners_get_control(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  ownersRecoverCommand: (parameters) =>
    sql`select openerp.owners_recover_command(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,

  recordExpenseTaxSource: (parameters) =>
    sql`select openerp.record_expense_tax_source(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  expenseTaxInventory: (parameters) =>
    sql`select openerp.expense_tax_inventory(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
  getExpenseTaxSource: (parameters) =>
    sql`select openerp.get_expense_tax_source(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  reviewExpenseTaxSource: (parameters) =>
    sql`select openerp.review_expense_tax_source(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  prepareExpenseTaxSnapshot: (parameters) =>
    sql`select openerp.prepare_expense_tax_snapshot(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  getExpenseTaxSnapshot: (parameters) =>
    sql`select openerp.get_expense_tax_snapshot(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,

  ...sourceIntakeStatements,
  ...registerReportStatements,
  ...reportComparisonStatements,
  ...closingDiscoveryStatements,
  ...preparationJobStopStatements,
  ...sieStatements,
  ...invoiceDraftStatements,
  ...supplierInvoiceDraftStatements,
  ...supplierAcceptanceStatements,
  ...supplierPaymentBatchStatements,
  ...subledgerControlStatements,
  ...exchangeRateStatements,
  ...invoiceIssuanceStatements,
  ...invoiceCancellationStatements,
  ...invoiceDocumentStatements,
  ...invoicePdfStatements,
  ...invoicePolicyStatements,
  ...invoiceDeliveryStatements,
  ...bankConnectorStatements,
  ...sieImportStatements,
  ...commerceAllocationReversalStatements,
  ...bankMatchReversalStatements,
  ...bankMatchCandidateStatements,
  ...bankSourceCoverageStatements,
  ...bankSignoffStatements,
  ...bankInventorySignoffStatements,
  ...taxAccountStatements,
  savePostingRequest: (parameters) =>
    sql`select openerp.save_posting_request(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  savePostingAuthorityRequest: (parameters) =>
    sql`select openerp.save_posting_authority_request(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  runPostingRequest: (parameters) =>
    sql`select openerp.run_posting_request(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  runPostingAuthorityRequest: (parameters) =>
    sql`select openerp.run_posting_authority_request(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  getSavedPostingRequest: (parameters) =>
    sql`select openerp.get_saved_posting_request(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listSavedPostingRequests: (parameters) =>
    sql`select openerp.list_saved_posting_requests(${parameters[0]}::text,${parameters[1]}::jsonb,NULLIF(${parameters[2]}::text,'')) as result`,

  prepareAccountantReview: (parameters) =>
    sql`select openerp.prepare_accountant_review(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  listAccountantReviews: (parameters) =>
    sql`select openerp.list_accountant_reviews(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  getAccountantReview: (parameters) =>
    sql`select openerp.get_accountant_review(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  accountantReviewRows: (parameters) =>
    sql`select openerp.accountant_review_rows_page(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::text) as result`,
  getAccountantReviewArtifact: (parameters) =>
    sql`select openerp.get_accountant_review_artifact(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,

  createSchedule: (parameters) =>
    sql`select openerp.create_schedule(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  listSchedules: (parameters) =>
    sql`select openerp.list_schedules(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  getSchedule: (parameters) =>
    sql`select openerp.get_schedule(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  reviseSchedule: (parameters) =>
    sql`select openerp.revise_schedule(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  prepareScheduleOccurrence: (parameters) =>
    sql`select openerp.prepare_schedule_occurrence(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  declareClosingInventory: (parameters) =>
    sql`select openerp.declare_closing_inventory(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  closingReadiness: (parameters) =>
    sql`select openerp.get_closing_readiness(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  prepareClosing: (parameters) =>
    sql`select openerp.prepare_closing(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getClosingProposal: (parameters) =>
    sql`select openerp.get_closing_proposal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  approveClosing: (parameters) =>
    sql`select openerp.approve_closing(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeClosing: (parameters) =>
    sql`select openerp.execute_closing(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  closingHistory: (parameters) =>
    sql`select openerp.get_closing_history(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
  getClosingCertificate: (parameters) =>
    sql`select openerp.get_closing_certificate(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,

  commerceCreateCounterparty: (parameters) =>
    sql`select openerp.commerce_create_counterparty(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  commerceReviseCounterparty: (parameters) =>
    sql`select openerp.commerce_revise_counterparty(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  commerceGetCounterparty: (parameters) =>
    sql`select openerp.commerce_get_counterparty(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
  commerceListCounterparties: (parameters) =>
    sql`select openerp.commerce_list_counterparties(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  commerceCreateInvoice: (parameters) =>
    sql`select openerp.commerce_create_invoice(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  commerceReviseInvoice: (parameters) =>
    sql`select openerp.commerce_revise_invoice(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  commerceGetInvoice: (parameters) =>
    sql`select openerp.commerce_get_invoice(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  commerceInvoicePayments: (parameters) =>
    sql`select openerp.commerce_invoice_payments(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  commerceInvoiceHistory: (parameters) =>
    sql`select openerp.commerce_invoice_history(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
  commerceSupplierInvoiceDuplicates: (parameters) =>
    sql`select openerp.commerce_supplier_invoice_duplicates(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::jsonb) as result`,
  commerceListInvoices: (parameters) =>
    sql`select openerp.commerce_list_invoices(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  commerceGetPaymentCapacity: (parameters) =>
    sql`select openerp.commerce_get_payment_capacity(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
  commercePrepareAllocation: (parameters) =>
    sql`select openerp.commerce_prepare_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  commerceGetAllocation: (parameters) =>
    sql`select openerp.commerce_get_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  commerceApproveAllocation: (parameters) =>
    sql`select openerp.commerce_approve_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  commerceApplyAllocation: (parameters) =>
    sql`select openerp.commerce_apply_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,

  prepareBankAllocation: (parameters) =>
    sql`select openerp.prepare_bank_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  getBankAllocation: (parameters) =>
    sql`select openerp.get_bank_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  approveBankAllocation: (parameters) =>
    sql`select openerp.approve_bank_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeBankAllocation: (parameters) =>
    sql`select openerp.execute_bank_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  reconcileBankCapacity: (parameters) =>
    sql`select openerp.reconcile_bank_capacity(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  getBankCapacityReconciliation: (parameters) =>
    sql`select openerp.get_bank_capacity_reconciliation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  prepareCorrectionImpact: (parameters) =>
    sql`select openerp.prepare_correction_impact(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getCorrectionImpact: (parameters) =>
    sql`select openerp.get_correction_impact(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  getCorrectionChain: (parameters) =>
    sql`select openerp.get_correction_chain(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listCorrectionBundles: (parameters) =>
    sql`select openerp.list_correction_bundles(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  recoverCorrectionRequest: (parameters) =>
    sql`select openerp.recover_correction_request(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  prepareCorrectionBundle: (parameters) =>
    sql`select openerp.prepare_correction_bundle(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getCorrectionBundle: (parameters) =>
    sql`select openerp.get_correction_bundle(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  getCorrectionBundleForVoucher: (parameters) =>
    sql`select openerp.get_correction_bundle_for_voucher(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  approveCorrectionBundle: (parameters) =>
    sql`select openerp.approve_correction_bundle(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeCorrectionBundle: (parameters) =>
    sql`select openerp.execute_correction_bundle(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  listPostingRecovery: (parameters) =>
    sql`select openerp.list_posting_recovery(${parameters[0]}::text,${parameters[1]}::jsonb,NULLIF(${parameters[2]}::text,'')) as result`,
  getPostingRecovery: (parameters) =>
    sql`select openerp.get_posting_recovery(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,NULLIF(${parameters[3]}::text,'')) as result`,
  recoverPostingRequest: (parameters) =>
    sql`select openerp.recover_posting_request(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  proposeRecurringRule: (parameters) =>
    sql`select openerp.propose_recurring_rule(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getRecurringRule: (parameters) =>
    sql`select openerp.get_recurring_rule(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  simulateRecurringRule: (parameters) =>
    sql`select openerp.simulate_recurring_rule(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getRecurringSimulation: (parameters) =>
    sql`select openerp.get_recurring_simulation(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  activateRecurringRule: (parameters) =>
    sql`select openerp.activate_recurring_rule(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  deactivateRecurringRule: (parameters) =>
    sql`select openerp.deactivate_recurring_rule(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  createPreparationRun: (parameters) =>
    sql`select openerp.create_preparation_run(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getPreparationRun: (parameters) =>
    sql`select openerp.get_preparation_run(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  advancePreparationRun: (parameters) =>
    sql`select openerp.advance_preparation_run(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::jsonb) as result`,
  prepareCaseSnapshot: (parameters) =>
    sql`select openerp.prepare_case_snapshot(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  listCases: (parameters) =>
    sql`select openerp.list_cases(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getCaseContext: (parameters) =>
    sql`select openerp.get_case_context(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::jsonb) as result`,
  bookStatus: (parameters) =>
    sql`select openerp.get_book_status(${parameters[0]}::text, ${parameters[1]}::jsonb) as result`,
  importBankStatement: (parameters) =>
    sql`select openerp.import_bank_statement(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getBankStatement: (parameters) =>
    sql`select openerp.get_bank_statement(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  matchBankObservation: (parameters) =>
    sql`select openerp.match_bank_observation(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  reconcileBank: (parameters) =>
    sql`select openerp.reconcile_bank(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  bankWorkspace: (parameters) =>
    sql`select openerp.bank_workspace(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::jsonb) as result`,
  getBankReconciliation: (parameters) =>
    sql`select openerp.get_bank_reconciliation(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  prepareReport: (parameters) =>
    sql`select openerp.prepare_report(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  listReports: (parameters) =>
    sql`select openerp.list_reports(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  getReport: (parameters) =>
    sql`select openerp.get_report(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  reportLines: (parameters) =>
    sql`select openerp.get_report_lines(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text) as result`,
  reportGeneralLedger: (parameters) =>
    sql`select openerp.report_general_ledger(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::text) as result`,
  reportExplanation: (parameters) =>
    sql`select openerp.explain_report_line(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::text) as result`,
  listBooks: (parameters) => sql`select openerp.list_books(${parameters[0]}::text) as result`,
  bookSetup: (parameters) =>
    sql`select openerp.book_setup(${parameters[0]}::text, ${parameters[1]}::jsonb) as result`,
  createEvidence: (parameters) =>
    sql`select openerp.create_evidence(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getEvidence: (parameters) =>
    sql`select openerp.get_evidence(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  prepareJournal: (parameters) =>
    sql`select openerp.prepare_journal(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getChange: (parameters) =>
    sql`select openerp.get_change(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  validateChange: (parameters) =>
    sql`select openerp.validate_change(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text) as result`,
  approveChange: (parameters) =>
    sql`select openerp.approve_change(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::jsonb) as result`,
  executeChange: (parameters) =>
    sql`select openerp.execute_change(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::jsonb) as result`,
  prepareCorrection: (parameters) =>
    sql`select openerp.prepare_correction(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::jsonb) as result`,
  getVoucher: (parameters) =>
    sql`select openerp.get_voucher(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  listVouchers: (parameters) =>
    sql`select openerp.list_vouchers(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  ledgerSnapshot: (parameters) =>
    sql`select openerp.ledger_snapshot(${parameters[0]}::text, ${parameters[1]}::jsonb) as result`,
  getReceipt: (parameters) =>
    sql`select openerp.get_receipt(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;

export type DatabaseOperation = keyof typeof statements;

function queryFailure(error: EffectDrizzleQueryError) {
  const nested = Cause.isCause(error.cause) ? Cause.findErrorOption(error.cause) : Option.none();
  if (Option.isNone(nested) || !SqlError.isSqlError(nested.value)) return failure("InternalError");
  const cause = nested.value.reason.cause;
  if (Schema.is(PostgresFailure)(cause)) {
    if (cause.code === "P0001" && Schema.is(Accounting.FailureCode)(cause.detail)) {
      // Expose only intentional domain messages, never Drizzle's query or bound parameters.
      return new Accounting.AccountingError({
        code: cause.detail,
        message: cause.message ?? failure(cause.detail).message,
      });
    }
    if (
      // Socket failures retain Node error codes rather than PostgreSQL SQLSTATEs.
      ["ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(cause.code) ||
      cause.code.startsWith("08") ||
      cause.code.startsWith("53") ||
      ["57014", "57P01", "57P02", "57P03"].includes(cause.code)
    ) {
      return failure("Unavailable");
    }
    return failure("InternalError");
  }
  return failure("Unavailable");
}

export function query<A>(
  operation: DatabaseOperation,
  parameters: Array<string>,
  schema: Schema.Decoder<A>,
) {
  return Effect.gen(function* () {
    const { bindings } = yield* RequestEnvironment;
    const connectionString = bindings.HYPERDRIVE?.connectionString || bindings.DATABASE_URL;
    if (!connectionString) return yield* failure("Unavailable");

    return yield* Effect.gen(function* () {
      const db = yield* Database;
      const result = yield* db
        .execute<{ result: unknown }>(statements[operation](parameters), "objects")
        .pipe(Effect.mapError(queryFailure));
      return yield* Schema.decodeUnknownEffect(schema)(result[0]?.result).pipe(
        Effect.mapError(() => failure("InternalError")),
      );
    }).pipe(
      Effect.provide(
        databaseLayer({
          connectionString: Redacted.make(connectionString),
          applicationName: "open-erp-api",
          connectTimeoutMs: 5000,
          statementTimeoutMs: 15000,
        }),
      ),
      Effect.mapError((error) => (SqlError.isSqlError(error) ? failure("Unavailable") : error)),
    );
  });
}

export function scopeParameter(scope: typeof Accounting.Scope.Type) {
  return JSON.stringify({ entityId: scope.entityId, bookId: scope.bookId });
}

import { CompanySetupCapabilities } from "./company-setup";
import { CompanyProfileCapabilities } from "./company-profiles";
import { LegalDeliveryCapabilities } from "./legal-delivery";
import { LegalInvoicePdfCapabilities } from "./legal-invoice-pdf";
import { LegalSalesPolicyCapabilities } from "./legal-sales-policy";
import * as Schema from "effect/Schema";
import * as Accounting from "./accounting";
import * as Reports from "./reports";
import { StatementCapabilities } from "./report-statements";
import * as Reconciliation from "./reconciliation";
import { CaseCapabilities } from "./cases";
import * as Automation from "./automation";
import { PostingRecoveryCapabilities } from "./posting-recovery";
import { CorrectionCapabilities } from "./corrections";
import { SettlementCapabilities } from "./settlements";
import { BankMatchReversalCapabilities } from "./bank-match-reversals";
import { BankMatchCandidateCapabilities } from "./bank-match-candidates";
import { BankSourceCoverageCapabilities } from "./bank-source-coverage";
import { BankSignoffCapabilities } from "./bank-signoffs";
import { BankInventorySignoffCapabilities } from "./bank-inventory-signoffs";
import { TaxAccountCapabilities } from "./tax-account";

import { SubledgerCapabilities } from "./subledgers";

import { ClosingCapabilities } from "./closing";

import { CommerceCapabilities } from "./commerce";
import { RegisterReportCapabilities } from "./register-reports";
import { VatReturnCapabilities } from "./vat-returns";
import { SieCapabilities } from "./sie";
import { Sie4ECapabilities } from "./sie4e";
import { InvoiceDraftCapabilities } from "./invoice-drafts";
import { SupplierInvoiceDraftCapabilities } from "./supplier-invoice-drafts";
import { SupplierAcceptanceCapabilities } from "./supplier-acceptance";
import { PurchaseRecognitionCapabilities } from "./supplier-recognition";
import { SupplierPaymentBatchCapabilities } from "./supplier-payment-batches";
import { SupplierCreditCapabilities } from "./supplier-credits";
import { SubledgerControlCapabilities } from "./subledger-controls";
import { ExchangeRateCapabilities } from "./exchange-rates";
import { InvoiceIssuanceCapabilities } from "./invoice-issuance";
import { InvoiceCancellationCapabilities } from "./invoice-cancellations";
import { InvoiceDocumentCapabilities } from "./invoice-documents";
import { InvoicePdfCapabilities } from "./invoice-pdf";
import { InvoicePolicyCapabilities } from "./invoice-policy";
import { InvoiceDeliveryCapabilities } from "./invoice-delivery";
import { ArLegalIssueCapabilities } from "./ar-legal-issue";
import { CommerceAllocationReversalCapabilities } from "./commerce-allocation-reversals";
import { AccountantReviewCapabilities } from "./accountant-review";
import { SourceIntakeCapabilities } from "./source-intake";
import { ExpenseTaxCapabilities } from "./expense-tax";
import { OwnerRegisterCapabilities } from "./owner-register";
import { FirmCapabilities } from "./firms";
import { WorkspaceCapabilities } from "./workspace";
import { CatalogCapabilities } from "./catalog";
import { DimensionsCapabilities } from "./dimensions";
import { CrmMasterCapabilities } from "./crm-master";
import { CollectionsCapabilities } from "./collections";
import { DeadlinesCapabilities } from "./deadlines";
import { RuleImpactCapabilities } from "./rule-impact";
import { SupplierInboxCapabilities } from "./supplier-inbox";
import { PayrollCalculationCapabilities } from "./payroll-calculations";
import { SupplierExtractionCapabilities } from "./supplier-extraction";

const scoped = { scope: Accounting.Scope };

const mutation = {
  ...scoped,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};

const change = { ...scoped, changeSetId: Accounting.Identifier };

const changeMutation = { ...mutation, changeSetId: Accounting.Identifier };

export const Capabilities = {
  runs_start_background: {
    description:
      "Admit a ready preparation run for durable background execution. Authority is rechecked for every chunk; manual changes stop the job. Posting requires separate approval.",
    input: Schema.Struct({ ...mutation, runId: Accounting.Identifier }),
    output: Automation.PreparationJob,
    readOnly: false,
  },
  runs_get_background: {
    description:
      "Read the latest durable background preparation job, including its stopped or blocked reason.",
    input: Schema.Struct({ ...scoped, runId: Accounting.Identifier }),
    output: Schema.NullOr(Automation.PreparationJob),
    readOnly: true,
  },
  ...WorkspaceCapabilities,
  ...FirmCapabilities,
  ...CompanySetupCapabilities,
  ...CompanyProfileCapabilities,
  ...LegalDeliveryCapabilities,
  ...LegalInvoicePdfCapabilities,
  ...LegalSalesPolicyCapabilities,
  ...AccountantReviewCapabilities,
  ...SourceIntakeCapabilities,
  ...ExpenseTaxCapabilities,
  ...OwnerRegisterCapabilities,
  ...CommerceCapabilities,
  ...RegisterReportCapabilities,
  ...Reports.ReportFamilyCapabilities,
  ...Reports.ReportComparisonCapabilities,
  ...StatementCapabilities,
  ...VatReturnCapabilities,
  ...SieCapabilities,
  ...Sie4ECapabilities,
  ...InvoiceDraftCapabilities,
  ...SupplierInvoiceDraftCapabilities,
  ...SupplierAcceptanceCapabilities,
  ...PurchaseRecognitionCapabilities,
  ...SupplierPaymentBatchCapabilities,
  ...SupplierCreditCapabilities,
  ...SubledgerControlCapabilities,
  ...ExchangeRateCapabilities,
  ...InvoiceIssuanceCapabilities,
  ...InvoiceCancellationCapabilities,
  ...InvoiceDocumentCapabilities,
  ...InvoicePdfCapabilities,
  ...InvoicePolicyCapabilities,
  ...InvoiceDeliveryCapabilities,
  ...ArLegalIssueCapabilities,
  ...CommerceAllocationReversalCapabilities,
  ...CatalogCapabilities,
  ...DimensionsCapabilities,
  ...CrmMasterCapabilities,
  ...CollectionsCapabilities,
  ...DeadlinesCapabilities,
  ...RuleImpactCapabilities,
  ...SupplierInboxCapabilities,
  ...SupplierExtractionCapabilities,
  ...ClosingCapabilities,
  ...Automation.PreparationJobStopCapabilities,
  ...SubledgerCapabilities,
  ...PostingRecoveryCapabilities,
  ...CorrectionCapabilities,
  ...SettlementCapabilities,
  ...BankMatchReversalCapabilities,
  ...BankMatchCandidateCapabilities,
  ...BankSourceCoverageCapabilities,
  ...BankSignoffCapabilities,
  ...BankInventorySignoffCapabilities,
  ...TaxAccountCapabilities,
  ...PayrollCalculationCapabilities,
  rules_propose: {
    description:
      "Propose an immutable synthetic exact-match recurring PREPARATION rule. It never grants posting authority.",
    input: Schema.Struct({ ...mutation, input: Automation.ProposeRecurringRule }),
    output: Automation.RecurringRule,
    readOnly: false,
  },
  rules_get: {
    description:
      "Read an immutable recurring rule, its active preparation authority and live dependency status.",
    input: Schema.Struct({ ...scoped, ruleId: Accounting.Identifier }),
    output: Automation.RecurringRuleView,
    readOnly: true,
  },
  rules_simulate: {
    description:
      "Freeze exact eligible unmatched bank observations and conflict diagnostics. Does not activate, approve or post.",
    input: Schema.Struct({ ...mutation, input: Automation.SimulateRecurringRule }),
    output: Automation.RuleSimulation,
    readOnly: false,
  },
  rules_get_simulation: {
    description:
      "Read an immutable simulation for operator review. Its captured observations are not a live permission to activate.",
    input: Schema.Struct({ ...scoped, simulationId: Accounting.Identifier }),
    output: Automation.RuleSimulation,
    readOnly: true,
  },
  runs_create_preparation: {
    description:
      "Freeze a durable preparation run under an operator-activated rule. Every resulting journal still requires separate human approval and execution.",
    input: Schema.Struct({ ...mutation, input: Automation.CreatePreparationRun }),
    output: Automation.PreparationRun,
    readOnly: false,
  },
  runs_get: {
    description:
      "Recover a durable preparation run and its cursor, audit and results. Completed means prepared, never posted.",
    input: Schema.Struct({ ...scoped, runId: Accounting.Identifier }),
    output: Automation.PreparationRun,
    readOnly: true,
  },
  runs_advance: {
    description:
      "Continue, cancel or resume at most20 preparation rows. Cancel never removes proposals or reverses vouchers. A stable retry key recovers the committed chunk.",
    input: Schema.Struct({
      ...mutation,
      runId: Accounting.Identifier,
      input: Automation.AdvancePreparationRun,
    }),
    output: Automation.PreparationRun,
    readOnly: false,
  },
  ...CaseCapabilities,
  book_get_status: {
    description:
      "Discover installed book features and explicit production-readiness blockers. Installed, available and verified are different states.",
    input: Schema.Struct(scoped),
    output: Accounting.BookStatus,
    readOnly: true,
  },
  bank_import_statement: {
    description:
      "Import retained synthetic statement JSON and supplied matches without posting. Distinct rows remain distinct. Unsupported overlap or split matches reject atomically.",
    input: Schema.Struct({ ...mutation, input: Reconciliation.ImportBankStatement }),
    output: Reconciliation.StatementImportReceipt,
    readOnly: false,
  },
  bank_get_statement: {
    description:
      "Read a retained synthetic bank statement and its immutable imported or explicit matches.",
    input: Schema.Struct({ ...scoped, statementId: Accounting.Identifier }),
    output: Reconciliation.BankStatementView,
    readOnly: true,
  },
  bank_match_observation: {
    description:
      "Connect one retained observation to one exact posted bank line without another posting. Splits, timing matches and double consumption are unsupported.",
    input: Schema.Struct({ ...mutation, input: Reconciliation.BankMatchInput }),
    output: Reconciliation.BankMatchReceipt,
    readOnly: false,
  },
  bank_reconcile: {
    description:
      "Freeze account-interval bank reconciliation with full source rows, unmatched lines, exact balances and declared coverage gaps. Not a whole-period close certificate.",
    input: Schema.Struct({ ...mutation, input: Reconciliation.ReconcileBank }),
    output: Reconciliation.BankReconciliation,
    readOnly: false,
  },
  bank_get_reconciliation: {
    description: "Read immutable bank reconciliation and current targeted source/ledger freshness.",
    input: Schema.Struct({ ...scoped, reconciliationId: Accounting.Identifier }),
    output: Reconciliation.BankReconciliationView,
    readOnly: true,
  },
  reports_prepare: {
    description:
      "Prepare an immutable synthetic internal trial balance at a committed sequence. Does not establish source completeness or statutory compliance.",
    input: Schema.Struct({ ...mutation, input: Reports.PrepareReport }),
    output: Reports.ReportSnapshot,
    readOnly: false,
  },
  reports_list: {
    description:
      "Rediscover retained report snapshots in this book. Follow next until null; this is a live inventory, not a claim of source completeness. Open a report ID to inspect its frozen ledger basis.",
    input: Schema.Struct({ ...scoped, ...Reports.LinesQuery.fields }),
    output: Reports.ReportSnapshotPage,
    readOnly: true,
  },
  reports_get: {
    description: "Read the immutable report header, complete-scope totals and limitations.",
    input: Schema.Struct({ ...scoped, reportId: Accounting.Identifier }),
    output: Reports.ReportSnapshot,
    readOnly: true,
  },
  reports_lines: {
    description:
      "Page through frozen report account lines. Totals describe the whole report, not this page.",
    input: Schema.Struct({
      ...scoped,
      reportId: Accounting.Identifier,
      ...Reports.LinesQuery.fields,
    }),
    output: Reports.ReportLines,
    readOnly: true,
  },
  reports_general_ledger: {
    description:
      "Read one frozen report account's period movements and exact running balances in committed posting order. The cursor binds report and account; later postings cannot enter this snapshot. Opening uses retained earlier postings, not a reviewed fiscal opening set. Follow next until null.",
    input: Schema.Struct({
      ...scoped,
      reportId: Accounting.Identifier,
      lineId: Accounting.Identifier,
      ...Reports.GeneralLedgerQuery.fields,
    }),
    output: Reports.GeneralLedgerPage,
    readOnly: true,
  },
  reports_explain: {
    description:
      "Explain one report account through exact immutable voucher contributions and evidence references. Follow next until null.",
    input: Schema.Struct({
      ...scoped,
      reportId: Accounting.Identifier,
      lineId: Accounting.Identifier,
      ...Reports.ExplanationQuery.fields,
    }),
    output: Reports.ReportExplanation,
    readOnly: true,
  },
  book_list: {
    description:
      "List books available to this credential. Only the synthetic-core-v1 manual journal profile is implemented.",
    input: Schema.Struct({}),
    output: Schema.Array(Accounting.Book),
    readOnly: true,
  },
  book_get_setup: {
    description: "Read accounts, periods and known implementation blockers for a book.",
    input: Schema.Struct(scoped),
    output: Accounting.BookSetup,
    readOnly: true,
  },
  evidence_create: {
    description: "Retain text or JSON source evidence before preparing a synthetic manual journal.",
    input: Schema.Struct({ ...mutation, input: Accounting.CreateEvidence }),
    output: Accounting.Evidence,
    readOnly: false,
  },
  evidence_get: {
    description:
      "Read retained source evidence, its content and digest before approving a proposal.",
    input: Schema.Struct({ ...scoped, evidenceId: Accounting.Identifier }),
    output: Accounting.EvidenceContent,
    readOnly: true,
  },
  ledger_prepare_journal: {
    description:
      "Prepare an immutable manual journal proposal. Does not post. Tax must be not_applicable; synthetic-core-v1 only.",
    input: Schema.Struct({ ...mutation, input: Accounting.PrepareJournal }),
    output: Accounting.ChangeSet,
    readOnly: false,
  },
  changes_get: {
    description: "Read the exact sealed proposal and digest before validation or execution.",
    input: Schema.Struct(change),
    output: Accounting.ChangeSet,
    readOnly: true,
  },
  changes_validate: {
    description:
      "Validate a sealed proposal against current book dependencies. Does not approve or post.",
    input: Schema.Struct(changeMutation),
    output: Accounting.ValidationReport,
    readOnly: false,
  },
  changes_execute: {
    description:
      "Execute the exact digest and version after a human operator approves it outside MCP. Agent credentials cannot create approvals.",
    input: Schema.Struct({ ...changeMutation, input: Accounting.ExecuteChange }),
    output: Accounting.ExecutionReceipt,
    readOnly: false,
  },
  ledger_prepare_correction: {
    description:
      "Prepare a linked reversal proposal for an existing voucher. Does not change or delete the original. Requires operator approval before execution.",
    input: Schema.Struct({
      ...mutation,
      voucherId: Accounting.Identifier,
      input: Accounting.PrepareCorrection,
    }),
    output: Accounting.ChangeSet,
    readOnly: false,
  },
  ledger_get_voucher: {
    description: "Read an immutable posted voucher and its evidence references.",
    input: Schema.Struct({ ...scoped, voucherId: Accounting.Identifier }),
    output: Accounting.Voucher,
    readOnly: true,
  },
  ledger_list: {
    description: "Read a page of posted vouchers after a sequence. Follow next until null.",
    input: Schema.Struct({ ...scoped, ...Accounting.PageQuery.fields }),
    output: Accounting.VoucherPage,
    readOnly: true,
  },
  ledger_snapshot: {
    description:
      "Read account balances at a committed book sequence. This is not a statutory report or a completeness assertion.",
    input: Schema.Struct(scoped),
    output: Accounting.LedgerSnapshot,
    readOnly: true,
  },
  receipts_get: {
    description:
      "Recover a committed execution receipt by its idempotency key after an uncertain response.",
    input: Schema.Struct({
      ...scoped,
      key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
    }),
    output: Accounting.ExecutionReceipt,
    readOnly: true,
  },
};

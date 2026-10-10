import { EmployeeClaimsApi } from "./employee-claims";
import { MileageCorrectionApi } from "./mileage-corrections";
import { VariablePayReviewApi } from "./variable-pay-review";
import { DocumentSignaturesApi } from "./document-signatures";
import { FilingLifecycleApi } from "./filing-lifecycle";
import { PeppolExchangeApi } from "./peppol-exchange";
import { HistoricalAdoptionsApi } from "./historical-adoptions";
import { ProcessorClearingApi } from "./processor-clearing";
import { SiePartitionsApi } from "./sie-partitions";
import { PayrollSettlementApi } from "./payroll-settlements";
import { AssetDisposalsApi } from "./asset-disposals";
import { ForeignCashApi } from "./foreign-cash";
import { PayrollInputApi } from "./payroll-inputs";
import { LoanApi } from "./treasury-loans";
import { SupplierSettlementsApi } from "./supplier-settlements";
import { EvaluationsApi } from "./evaluations";
import { DeadlinesApi } from "./deadlines";
import { RuleImpactApi } from "./rule-impact";
import { PayrollFoundationApi } from "./payroll-foundation";
import { PayrollRunApi } from "./payroll-runs";
import { PayrollCalculationApi } from "./payroll-calculations";
import { CorporateTaxApi } from "./corporate-tax";
import { AnnualReportApi } from "./annual-report";
import { CrmMasterApi } from "./crm-master";
import { InvoiceTemplatesApi } from "./invoice-templates";
import { CatalogApi } from "./catalog";
import { CollectionsApi } from "./collections";
import { DimensionsApi } from "./dimensions";
import { SupplierInboxApi } from "./supplier-inbox";
import { SupplierExtractionApi } from "./supplier-extraction";
import { CompanySetupApi } from "./company-setup";
import { CompanyProfileApi } from "./company-profiles";
import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import * as Accounting from "./accounting";
import { SystemStatus } from "./system";
import { ReportApi } from "./reports";
import { StatementApi } from "./report-statements";
import { accountingErrors } from "./accounting-errors";
import { ReconciliationApi } from "./reconciliation";
import { CasesApi } from "./cases";
import { AutomationApi } from "./automation";
import { PostingRecoveryApi } from "./posting-recovery";
import { CorrectionApi } from "./corrections";
import { SettlementsApi } from "./settlements";
import { BankMatchReversalsApi } from "./bank-match-reversals";
import { BankMatchCandidatesApi } from "./bank-match-candidates";
import { CashForecastApi } from "./cash-forecast";
import { BankSourceCoverageApi } from "./bank-source-coverage";
import { BankSignoffApi } from "./bank-signoffs";
import { BankInventorySignoffApi } from "./bank-inventory-signoffs";
import { TaxAccountApi } from "./tax-account";

import { SubledgersApi } from "./subledgers";

import { ClosingApi } from "./closing";

import { CommerceApi } from "./commerce";
import { CommerceFxApi } from "./commerce-fx";
import { PeriodWorkApi } from "./period-work";
import { RegisterReportsApi } from "./register-reports";
import { VatReturnsApi } from "./vat-returns";
import { VatAssessmentApi } from "./vat-assessment";
import { SieApi } from "./sie";
import { Sie4EApi } from "./sie4e";
import { InvoiceDraftsApi } from "./invoice-drafts";
import { RecurringInvoicesApi } from "./recurring-invoices";
import { SalesOrdersApi } from "./sales-orders";
import { SupplierInvoiceDraftsApi } from "./supplier-invoice-drafts";
import { SupplierAcceptanceApi } from "./supplier-acceptance";
import { ServicePurchaseApi } from "./service-purchases";
import { PurchaseRecognitionApi } from "./supplier-recognition";
import { SupplierPaymentBatchesApi } from "./supplier-payment-batches";
import { PaymentResolutionsApi } from "./payment-resolutions";
import { PaymentIdentifiersApi } from "./payment-identifiers";
import { SupplierCreditsApi } from "./supplier-credits";
import { SupplierRefundsApi } from "./supplier-refunds";
import { SubledgerControlsApi } from "./subledger-controls";
import { ExchangeRatesApi } from "./exchange-rates";
import { InvoiceIssuanceApi } from "./invoice-issuance";
import { InvoiceCancellationsApi } from "./invoice-cancellations";
import { InvoiceDocumentsApi } from "./invoice-documents";
import { InvoicePdfApi } from "./invoice-pdf";
import { InvoicePolicyApi } from "./invoice-policy";
import { InvoiceDeliveryApi } from "./invoice-delivery";
import { BankConnectorApi } from "./bank-connector";
import { SieImportApi } from "./sie-import";
import { HistoricalMigrationApi } from "./historical-migration";
import { ArLegalIssueApi } from "./ar-legal-issue";
import { CustomerCreditNotesApi } from "./customer-credit-notes";
import { LegalSalesPolicyApi } from "./legal-sales-policy";
import { LegalInvoicePdfApi } from "./legal-invoice-pdf";
import { LegalDeliveryApi } from "./legal-delivery";
import { CommerceAllocationReversalsApi } from "./commerce-allocation-reversals";
import { AccountantReviewApi } from "./accountant-review";
import { SourceIntakeApi } from "./source-intake";
import { ExpenseTaxApi } from "./expense-tax";
import { OwnerRegisterApi } from "./owner-register";
import { OwnerOperationsApi } from "./owner-operations";
import { FinancialCloseApi } from "./financial-close";
import { CashFlowApi } from "./cash-flow";
import { PartyIdentityApi } from "./party-identity";
import { BankSyncWindowsApi } from "./bank-sync-windows";
import { BankSourceRevisionsApi } from "./bank-source-revisions";
import { PrepaymentsApi } from "./prepayments";
import { CashMethodApi } from "./cash-method";
import { FirmApi } from "./firms";
import { PresenceApi } from "./presence";
import { PostingMandateApi } from "./posting-mandates";
import { WorkspaceApi } from "./workspace";
import { describeAuthentication } from "./api-authentication";
import { OnboardingApi } from "./onboarding";
import { OnboardingDeltasApi } from "./onboarding-deltas";
import { OnboardingMappingsApi } from "./onboarding-mappings";

export { AccountingErrorStatus } from "./accounting-errors";

const SystemApi = HttpApiGroup.make("system").add(
  HttpApiEndpoint.get("health", "/health", {
    success: Schema.Struct({ status: Schema.Literal("ok") }),
  }),
  HttpApiEndpoint.get("status", "/v1/system", { success: SystemStatus }),
);

const bookPath = "/v1/entities/:entityId/books/:bookId";

const scoped = { params: Accounting.Scope, error: accountingErrors };

const identified = { params: Accounting.ChangePath, error: accountingErrors };

const mutation = { ...scoped, headers: Accounting.IdempotencyHeaders };

const identifiedMutation = { ...identified, headers: Accounting.IdempotencyHeaders };

const AccountingApi = HttpApiGroup.make("accounting").add(
  HttpApiEndpoint.get("bookStatus", `${bookPath}/status`, {
    ...scoped,
    success: Accounting.BookStatus,
  }),
  HttpApiEndpoint.get("listBooks", "/v1/books", {
    success: Schema.Array(Accounting.Book),
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("bookSetup", `${bookPath}/setup`, {
    ...scoped,
    success: Accounting.BookSetup,
  }),
  HttpApiEndpoint.post("createEvidence", `${bookPath}/evidence`, {
    ...mutation,
    payload: Accounting.CreateEvidence.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: Accounting.Evidence,
  }),
  HttpApiEndpoint.get("getEvidence", `${bookPath}/evidence/:id`, {
    ...identified,
    success: Accounting.EvidenceContent,
  }),
  HttpApiEndpoint.post("prepareJournal", `${bookPath}/change-sets`, {
    ...mutation,
    payload: Accounting.PrepareJournal.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: Accounting.ChangeSet,
  }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" }),
  HttpApiEndpoint.get("getChange", `${bookPath}/change-sets/:id`, {
    ...identified,
    success: Accounting.ChangeSet,
  }),
  HttpApiEndpoint.post("validateChange", `${bookPath}/change-sets/:id/validate`, {
    ...identifiedMutation,
    success: Accounting.ValidationReport,
  }),
  HttpApiEndpoint.post("approveChange", `${bookPath}/change-sets/:id/approvals`, {
    ...identifiedMutation,
    payload: Accounting.ApproveChange.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: Accounting.Approval,
  }),
  HttpApiEndpoint.post("executeChange", `${bookPath}/change-sets/:id/execute`, {
    ...identifiedMutation,
    payload: Accounting.ExecuteChange.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: Accounting.ExecutionReceipt,
  }),
  HttpApiEndpoint.post("prepareCorrection", `${bookPath}/vouchers/:id/correction-proposals`, {
    ...identifiedMutation,
    payload: Accounting.PrepareCorrection.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: Accounting.ChangeSet,
  }),
  HttpApiEndpoint.get("getVoucher", `${bookPath}/vouchers/:id`, {
    ...identified,
    success: Accounting.Voucher,
  }),
  HttpApiEndpoint.get("listVouchers", `${bookPath}/vouchers`, {
    ...scoped,
    query: Accounting.PageQuery,
    success: Accounting.VoucherPage,
  }),
  HttpApiEndpoint.get("ledgerSnapshot", `${bookPath}/ledger`, {
    ...scoped,
    success: Accounting.LedgerSnapshot,
  }),
  HttpApiEndpoint.get("getReceipt", `${bookPath}/receipts/:key`, {
    params: Schema.Struct({
      ...Accounting.Scope.fields,
      key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
    }),
    success: Accounting.ExecutionReceipt,
    error: accountingErrors,
  }),
);

export class Api extends HttpApi.make("open-erp")
  .add(
    SystemApi,
    WorkspaceApi,
    FirmApi,
    PresenceApi,
    PostingMandateApi,
    CompanySetupApi,
    OnboardingApi,
    OnboardingMappingsApi,
    OnboardingDeltasApi,
    CompanyProfileApi,
    EvaluationsApi,

    AccountingApi,
    ReportApi,
    StatementApi,
    CashFlowApi,
    PartyIdentityApi,
    BankSyncWindowsApi,
    BankSourceRevisionsApi,
    PrepaymentsApi,
    CashMethodApi,
    ReconciliationApi,
    CasesApi,
    AutomationApi,
    PostingRecoveryApi,
    CorrectionApi,
    SettlementsApi,
    BankMatchReversalsApi,
    BankMatchCandidatesApi,
    BankSourceCoverageApi,
    CashForecastApi,
    BankSignoffApi,
    BankInventorySignoffApi,
    TaxAccountApi,
    CommerceApi,
    CommerceFxApi,
    PeriodWorkApi,
    RegisterReportsApi,
    VatReturnsApi,
    VatAssessmentApi,
    SieApi,
    Sie4EApi,
    InvoiceDraftsApi,
    RecurringInvoicesApi,
    SalesOrdersApi,
    SupplierInvoiceDraftsApi,
    SupplierAcceptanceApi,
    SupplierSettlementsApi,
    ServicePurchaseApi,
    PurchaseRecognitionApi,
    SupplierPaymentBatchesApi,
    PaymentResolutionsApi,
    PaymentIdentifiersApi,
    SupplierCreditsApi,
    SupplierRefundsApi,
    SubledgerControlsApi,
    ExchangeRatesApi,
    InvoiceIssuanceApi,
    InvoiceCancellationsApi,
    InvoiceDocumentsApi,
    InvoicePdfApi,
    InvoicePolicyApi,
    InvoiceDeliveryApi,
    BankConnectorApi,
    SieImportApi,
    HistoricalMigrationApi,
    ArLegalIssueApi,
    CustomerCreditNotesApi,
    LegalSalesPolicyApi,
    LegalInvoicePdfApi,
    LegalDeliveryApi,
    CommerceAllocationReversalsApi,
    AccountantReviewApi,
    SourceIntakeApi,
    SupplierInboxApi,
    SupplierExtractionApi,
    CollectionsApi,
    CrmMasterApi,
    CatalogApi,
    InvoiceTemplatesApi,
    PayrollFoundationApi,
    PayrollCalculationApi,
    PayrollRunApi,
    ForeignCashApi,
    ProcessorClearingApi,
    SiePartitionsApi,
    HistoricalAdoptionsApi,
    DocumentSignaturesApi,
    FilingLifecycleApi,
    PeppolExchangeApi,
    PayrollInputApi,
    EmployeeClaimsApi,
    MileageCorrectionApi,
    VariablePayReviewApi,
    AssetDisposalsApi,
    PayrollSettlementApi,
    LoanApi,
    CorporateTaxApi,
    AnnualReportApi,
    DeadlinesApi,
    RuleImpactApi,
    DimensionsApi,
    ExpenseTaxApi,
    OwnerRegisterApi,
    OwnerOperationsApi,
    FinancialCloseApi,
    ClosingApi,
    SubledgersApi,
  )
  .prefix("/api")
  .annotateMerge(
    OpenApi.annotations({
      title: "Drastic API",
      version: "1.0.0",
      transform: describeAuthentication,
    }),
  ) {}

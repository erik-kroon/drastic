import { DeadlinesApi } from "./deadlines";
import { PayrollFoundationApi } from "./payroll-foundation";
import { CrmMasterApi } from "./crm-master";
import { CatalogApi } from "./catalog";
import { CollectionsApi } from "./collections";
import { DimensionsApi } from "./dimensions";
import { SupplierInboxApi } from "./supplier-inbox";
import { CompanySetupApi } from "./company-setup";
import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { SystemStatus } from "./system";
import { ReportApi } from "./reports";
import { accountingErrors } from "./accounting-errors";
import { ReconciliationApi } from "./reconciliation";
import { CasesApi } from "./cases";
import { AutomationApi } from "./automation";
import { PostingRecoveryApi } from "./posting-recovery";
import { CorrectionApi } from "./corrections";
import { SettlementsApi } from "./settlements";
import { BankMatchReversalsApi } from "./bank-match-reversals";
import { BankMatchCandidatesApi } from "./bank-match-candidates";
import { BankSourceCoverageApi } from "./bank-source-coverage";
import { BankSignoffApi } from "./bank-signoffs";
import { BankInventorySignoffApi } from "./bank-inventory-signoffs";
import { TaxAccountApi } from "./tax-account";

import { SubledgersApi } from "./subledgers";

import { ClosingApi } from "./closing";

import { CommerceApi } from "./commerce";
import { CommerceFxApi } from "./commerce-fx";
import { RegisterReportsApi } from "./register-reports";
import { VatReturnsApi } from "./vat-returns";
import { SieApi } from "./sie";
import { InvoiceDraftsApi } from "./invoice-drafts";
import { SalesOrdersApi } from "./sales-orders";
import { SupplierInvoiceDraftsApi } from "./supplier-invoice-drafts";
import { SupplierAcceptanceApi } from "./supplier-acceptance";
import { SupplierPaymentBatchesApi } from "./supplier-payment-batches";
import { SupplierCreditsApi } from "./supplier-credits";
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
import { LegalSalesPolicyApi } from "./legal-sales-policy";
import { LegalInvoicePdfApi } from "./legal-invoice-pdf";
import { LegalDeliveryApi } from "./legal-delivery";
import { CommerceAllocationReversalsApi } from "./commerce-allocation-reversals";
import { AccountantReviewApi } from "./accountant-review";
import { SourceIntakeApi } from "./source-intake";
import { ExpenseTaxApi } from "./expense-tax";
import { OwnerRegisterApi } from "./owner-register";
import { FirmApi } from "./firms";
import { WorkspaceApi } from "./workspace";

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
  }),
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
    CompanySetupApi,
    AccountingApi,
    ReportApi,
    ReconciliationApi,
    CasesApi,
    AutomationApi,
    PostingRecoveryApi,
    CorrectionApi,
    SettlementsApi,
    BankMatchReversalsApi,
    BankMatchCandidatesApi,
    BankSourceCoverageApi,
    BankSignoffApi,
    BankInventorySignoffApi,
    TaxAccountApi,
    CommerceApi,
    CommerceFxApi,
    RegisterReportsApi,
    VatReturnsApi,
    SieApi,
    InvoiceDraftsApi,
    SalesOrdersApi,
    SupplierInvoiceDraftsApi,
    SupplierAcceptanceApi,
    SupplierPaymentBatchesApi,
    SupplierCreditsApi,
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
    LegalSalesPolicyApi,
    LegalInvoicePdfApi,
    LegalDeliveryApi,
    CommerceAllocationReversalsApi,
    AccountantReviewApi,
    SourceIntakeApi,
    SupplierInboxApi,
    CollectionsApi,
    CrmMasterApi,
    CatalogApi,
    PayrollFoundationApi,
    DeadlinesApi,
    DimensionsApi,
    ExpenseTaxApi,
    OwnerRegisterApi,
    ClosingApi,
    SubledgersApi,
  )
  .prefix("/api")
  .annotateMerge(OpenApi.annotations({ title: "OpenERP API", version: "1.0.0" })) {}

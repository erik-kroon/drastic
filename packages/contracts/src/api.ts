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

import { SubledgersApi } from "./subledgers";

import { ClosingApi } from "./closing";

import { CommerceApi } from "./commerce";
import { RegisterReportsApi } from "./register-reports";
import { VatReturnsApi } from "./vat-returns";
import { SieApi } from "./sie";
import { InvoiceDraftsApi } from "./invoice-drafts";
import { AccountantReviewApi } from "./accountant-review";
import { SourceIntakeApi } from "./source-intake";
import { ExpenseTaxApi } from "./expense-tax";
import { OwnerRegisterApi } from "./owner-register";
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
    AccountingApi,
    ReportApi,
    ReconciliationApi,
    CasesApi,
    AutomationApi,
    PostingRecoveryApi,
    CorrectionApi,
    SettlementsApi,
    CommerceApi,
    RegisterReportsApi,
    VatReturnsApi,
    SieApi,
    InvoiceDraftsApi,
    AccountantReviewApi,
    SourceIntakeApi,
    ExpenseTaxApi,
    OwnerRegisterApi,
    ClosingApi,
    SubledgersApi,
  )
  .prefix("/api")
  .annotateMerge(OpenApi.annotations({ title: "OpenERP API", version: "1.0.0" })) {}

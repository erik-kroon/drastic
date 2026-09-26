import { DeadlineHandlers } from "./transport/http/routes/deadlines";
import { DeadlineFeedRoutes } from "./transport/http/routes/deadline-feed";
import { PayrollFoundationHandlers } from "./transport/http/routes/payroll-foundation";
import { CrmMasterHandlers } from "./transport/http/routes/crm-master";
import { CatalogHandlers } from "./transport/http/routes/catalog";
import { CollectionsHandlers } from "./transport/http/routes/collections";
import { DimensionHandlers } from "./transport/http/routes/dimensions";
import { SupplierInboxHandlers } from "./transport/http/routes/supplier-inbox";
import { CompanySetupHandlers } from "./transport/http/routes/company-setup";
import { Api } from "@open-erp/contracts/api";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { AccountingHandlers } from "./transport/http/routes/accounting";
import { authHandler } from "./adapters/auth/better-auth";
import { boundedRequest } from "./transport/http/body";
import { McpRoutes } from "./transport/mcp";
import { type Bindings, RequestEnvironment } from "./runtime/environment";
import { ReportHandlers } from "./transport/http/routes/reports";
import { CaseHandlers } from "./transport/http/routes/cases";
import { AutomationHandlers } from "./transport/http/routes/automation";
import { PostingRecoveryHandlers } from "./transport/http/routes/posting-recovery";
import { CorrectionHandlers } from "./transport/http/routes/corrections";
import { SettlementHandlers } from "./transport/http/routes/settlements";
import { BankMatchReversalHandlers } from "./transport/http/routes/bank-match-reversals";
import { BankMatchCandidateHandlers } from "./transport/http/routes/bank-match-candidates";
import { BankSourceCoverageHandlers } from "./transport/http/routes/bank-source-coverage";
import { BankSignoffHandlers } from "./transport/http/routes/bank-signoffs";
import { BankInventorySignoffHandlers } from "./transport/http/routes/bank-inventory-signoffs";
import { TaxAccountHandlers } from "./transport/http/routes/tax-account";
import { ReconciliationHandlers } from "./transport/http/routes/reconciliation";
import { AccountingErrorStatus } from "@open-erp/contracts/api";
import { databaseFailure } from "./db/transaction";
import { Database, databaseLayer } from "./db/connection";
import { failure } from "./application/failures";

import { SubledgerHandlers } from "./transport/http/routes/subledgers";

import { ClosingHandlers } from "./transport/http/routes/closing";

import { CommerceHandlers } from "./transport/http/routes/commerce";
import { CommerceFxHandlers } from "./transport/http/routes/commerce-fx";
import { RegisterReportHandlers } from "./transport/http/routes/register-reports";
import { VatReturnsHandlers } from "./transport/http/routes/vat-returns";
import { SieHandlers } from "./transport/http/routes/sie";
import { InvoiceDraftHandlers } from "./transport/http/routes/invoice-drafts";
import { SalesOrderHandlers } from "./transport/http/routes/sales-orders";
import { SupplierInvoiceDraftHandlers } from "./transport/http/routes/supplier-invoice-drafts";
import { SupplierAcceptanceHandlers } from "./transport/http/routes/supplier-acceptance";
import { SupplierPaymentBatchHandlers } from "./transport/http/routes/supplier-payment-batches";
import { SupplierCreditHandlers } from "./transport/http/routes/supplier-credits";
import { SubledgerControlsHandlers } from "./transport/http/routes/subledger-controls";
import { ExchangeRatesHandlers } from "./transport/http/routes/exchange-rates";
import { InvoiceIssuanceHandlers } from "./transport/http/routes/invoice-issuance";
import { InvoiceCancellationHandlers } from "./transport/http/routes/invoice-cancellations";
import { InvoiceDocumentHandlers } from "./transport/http/routes/invoice-documents";
import { InvoicePdfHandlers } from "./transport/http/routes/invoice-pdf";
import { InvoicePolicyHandlers } from "./transport/http/routes/invoice-policy";
import { InvoiceDeliveryHandlers } from "./transport/http/routes/invoice-delivery";
import { BankConnectorHandlers } from "./transport/http/routes/bank-connector";
import { SieImportHandlers } from "./transport/http/routes/sie-import";
import { HistoricalMigrationHandlers } from "./transport/http/routes/historical-migration";
import { ArLegalIssueHandlers } from "./transport/http/routes/ar-legal-issue";
import { LegalSalesPolicyHandlers } from "./transport/http/routes/legal-sales-policy";
import { LegalInvoicePdfHandlers } from "./transport/http/routes/legal-invoice-pdf";
import { LegalDeliveryHandlers } from "./transport/http/routes/legal-delivery";
import { CommerceAllocationReversalHandlers } from "./transport/http/routes/commerce-allocation-reversals";
import { AccountantReviewHandlers } from "./transport/http/routes/accountant-review";
import { SourceIntakeHandlers } from "./transport/http/routes/source-intake";
import { ExpenseTaxHandlers } from "./transport/http/routes/expense-tax";
import { OwnerRegisterHandlers } from "./transport/http/routes/owner-register";
import { FirmHandlers } from "./transport/http/routes/firms";
import { WorkspaceHandlers } from "./transport/http/routes/workspace";

const SystemHandlers = HttpApiBuilder.group(Api, "system", (handlers) =>
  handlers
    .handle("health", () => Effect.succeed({ status: "ok" }))
    .handle(
      "status",
      Effect.fn("System.status")(function* () {
        return {
          status: "ok" as const,
          service: "open-erp-api" as const,
          effectVersion: "4.0.0-rc.112" as const,
          checkedAt: yield* Clock.currentTimeMillis,
        };
      }),
    ),
);

const ApiRoutes = HttpApiBuilder.layer(Api, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide([
    SystemHandlers,
    WorkspaceHandlers,
    FirmHandlers,
    CompanySetupHandlers,
    AccountingHandlers,
    ReportHandlers,
    ReconciliationHandlers,
    CaseHandlers,
    AutomationHandlers,
    PostingRecoveryHandlers,
    CorrectionHandlers,
    SettlementHandlers,
    BankMatchReversalHandlers,
    BankMatchCandidateHandlers,
    BankSourceCoverageHandlers,
    BankSignoffHandlers,
    BankInventorySignoffHandlers,
    TaxAccountHandlers,
    CommerceHandlers,
    CommerceFxHandlers,
    RegisterReportHandlers,
    VatReturnsHandlers,
    SieHandlers,
    InvoiceDraftHandlers,
    SalesOrderHandlers,
    SupplierInvoiceDraftHandlers,
    SupplierAcceptanceHandlers,
    SupplierPaymentBatchHandlers,
    SupplierCreditHandlers,
    SubledgerControlsHandlers,
    ExchangeRatesHandlers,
    InvoiceIssuanceHandlers,
    InvoiceCancellationHandlers,
    InvoiceDocumentHandlers,
    InvoicePdfHandlers,
    InvoicePolicyHandlers,
    InvoiceDeliveryHandlers,
    BankConnectorHandlers,
    SieImportHandlers,
    HistoricalMigrationHandlers,
    ArLegalIssueHandlers,
    LegalSalesPolicyHandlers,
    LegalInvoicePdfHandlers,
    LegalDeliveryHandlers,
    CommerceAllocationReversalHandlers,
    AccountantReviewHandlers,
    SourceIntakeHandlers,
    SupplierInboxHandlers,
    CollectionsHandlers,
    CrmMasterHandlers,
    CatalogHandlers,
    PayrollFoundationHandlers,
    DeadlineHandlers,
    DimensionHandlers,
    ExpenseTaxHandlers,
    OwnerRegisterHandlers,
    ClosingHandlers,
    SubledgerHandlers,
  ]),
  Layer.provide(HttpServer.layerServices),
);

const { handler } = HttpRouter.toWebHandler(
  Layer.mergeAll(ApiRoutes, McpRoutes, DeadlineFeedRoutes),
  {
    disableLogger: true,
  },
);

function boundaryResponse(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return Response.json({ message: error.message }, { status: error.status });
  }

  const safe = databaseFailure(error);

  return Response.json({ message: safe.message }, { status: AccountingErrorStatus[safe.code] });
}

function withRequestDatabase<A, E, R>(bindings: Bindings, effect: Effect.Effect<A, E, R>) {
  const connectionString = bindings.HYPERDRIVE?.connectionString || bindings.DATABASE_URL;

  if (!connectionString) return Effect.fail(failure("Unavailable"));

  return effect.pipe(
    Effect.provide(
      databaseLayer({
        connectionString: Redacted.make(connectionString),
        applicationName: "open-erp-api",
        connectTimeoutMs: 5000,
        statementTimeoutMs: 15000,
      }),
    ),
    Effect.mapError(databaseFailure),
  );
}

export default {
  async fetch(request: Request, bindings: Bindings): Promise<Response> {
    const response = await Effect.runPromise(
      boundedRequest(request).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.succeed(boundaryResponse(error)),
          onSuccess: (bounded) =>
            new URL(bounded.url).pathname.startsWith("/api/auth/")
              ? authHandler(bounded, bindings)
              : withRequestDatabase(
                  bindings,
                  Effect.gen(function* () {
                    const db = yield* Database;

                    return yield* Effect.tryPromise({
                      try: () =>
                        handler(
                          bounded,
                          Context.make(RequestEnvironment, {
                            bindings,
                            url: new URL(request.url),
                          }).pipe(Context.add(Database, db)),
                        ),
                      catch: databaseFailure,
                    });
                  }),
                ),
        }),
      ),
    );

    response.headers.set("cache-control", "no-store");

    return response;
  },
};

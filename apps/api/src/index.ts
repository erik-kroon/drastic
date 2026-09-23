import { Api } from "@open-erp/contracts/api";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
import { ReconciliationHandlers } from "./transport/http/routes/reconciliation";

import { SubledgerHandlers } from "./transport/http/routes/subledgers";

import { ClosingHandlers } from "./transport/http/routes/closing";

import { CommerceHandlers } from "./transport/http/routes/commerce";
import { RegisterReportHandlers } from "./transport/http/routes/register-reports";
import { VatReturnsHandlers } from "./transport/http/routes/vat-returns";
import { SieHandlers } from "./transport/http/routes/sie";
import { InvoiceDraftHandlers } from "./transport/http/routes/invoice-drafts";
import { SubledgerControlsHandlers } from "./transport/http/routes/subledger-controls";
import { InvoiceIssuanceHandlers } from "./transport/http/routes/invoice-issuance";
import { CommerceAllocationReversalHandlers } from "./transport/http/routes/commerce-allocation-reversals";
import { AccountantReviewHandlers } from "./transport/http/routes/accountant-review";
import { SourceIntakeHandlers } from "./transport/http/routes/source-intake";
import { ExpenseTaxHandlers } from "./transport/http/routes/expense-tax";
import { OwnerRegisterHandlers } from "./transport/http/routes/owner-register";
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
    CommerceHandlers,
    RegisterReportHandlers,
    VatReturnsHandlers,
    SieHandlers,
    InvoiceDraftHandlers,
    SubledgerControlsHandlers,
    InvoiceIssuanceHandlers,
    CommerceAllocationReversalHandlers,
    AccountantReviewHandlers,
    SourceIntakeHandlers,
    ExpenseTaxHandlers,
    OwnerRegisterHandlers,
    ClosingHandlers,
    SubledgerHandlers,
  ]),
  Layer.provide(HttpServer.layerServices),
);

const { handler } = HttpRouter.toWebHandler(Layer.merge(ApiRoutes, McpRoutes), {
  disableLogger: true,
});

export default {
  async fetch(request: Request, bindings: Bindings): Promise<Response> {
    const response = await Effect.runPromise(
      boundedRequest(request).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.succeed(Response.json({ message: error.message }, { status: error.status })),
          onSuccess: (bounded) =>
            new URL(bounded.url).pathname.startsWith("/api/auth/")
              ? authHandler(bounded, bindings)
              : Effect.promise(() =>
                  handler(
                    bounded,
                    Context.make(RequestEnvironment, { bindings, url: new URL(request.url) }),
                  ),
                ),
        }),
      ),
    );
    response.headers.set("cache-control", "no-store");
    return response;
  },
};

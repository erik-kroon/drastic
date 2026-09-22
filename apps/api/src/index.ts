import { Api } from "@open-erp/contracts/api";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { AccountingHandlers } from "./accounting";
import { authHandler } from "./better-auth";
import { boundedRequest } from "./body";
import { McpRoutes } from "./mcp";
import { type Bindings, RequestEnvironment } from "./database";
import { ReportHandlers } from "./reports";
import { CaseHandlers } from "./cases";
import { AutomationHandlers } from "./automation";
import { PostingRecoveryHandlers } from "./posting-recovery";
import { CorrectionHandlers } from "./corrections";
import { SettlementHandlers } from "./settlements";
import { ReconciliationHandlers } from "./reconciliation";

import { SubledgerHandlers } from "./subledgers";

import { ClosingHandlers } from "./closing";

import { CommerceHandlers } from "./commerce";
import { AccountantReviewHandlers } from "./accountant-review";
import { SourceIntakeHandlers } from "./source-intake";
import { ExpenseTaxHandlers } from "./expense-tax";
import { OwnerRegisterHandlers } from "./owner-register";

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
    AccountingHandlers,
    ReportHandlers,
    ReconciliationHandlers,
    CaseHandlers,
    AutomationHandlers,
    PostingRecoveryHandlers,
    CorrectionHandlers,
    SettlementHandlers,
    CommerceHandlers,
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

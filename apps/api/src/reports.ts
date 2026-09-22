import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "./auth";
import { capabilities } from "./capabilities";

export const ReportHandlers = HttpApiBuilder.group(Api, "reports", (handlers) =>
  handlers
    .handle("prepareReport", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.reports_prepare.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getReport", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.reports_get.execute(token, { scope: params, reportId: params.id }),
      ),
    )
    .handle("reportLines", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.reports_lines.execute(token, {
          scope: params,
          reportId: params.id,
          after: query.after,
        }),
      ),
    )
    .handle("reportExplanation", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.reports_explain.execute(token, {
          scope: params,
          reportId: params.id,
          lineId: params.lineId,
          after: query.after,
        }),
      ),
    ),
);

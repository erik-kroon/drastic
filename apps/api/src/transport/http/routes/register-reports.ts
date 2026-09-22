import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";

export const RegisterReportHandlers = HttpApiBuilder.group(Api, "registerReports", (handlers) =>
  handlers
    .handle("createRegisterReport", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_create_register_report.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getRegisterReport", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_register_report.execute(token, { scope: params, id: params.id }),
      ),
    )
    .handle("listRegisterReports", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_list_register_reports.execute(token, {
          scope: params,
          after: query.after,
        }),
      ),
    ),
);

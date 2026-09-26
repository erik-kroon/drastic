import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as RegisterReports from "../../../application/register-reports";

export const RegisterReportHandlers = HttpApiBuilder.group(Api, "registerReports", (handlers) =>
  handlers
    .handle("createRegisterReport", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        RegisterReports.createRegisterReport(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getRegisterReport", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        RegisterReports.getRegisterReport(token, {
          scope: scopeFromPath(params),
          reportId: params.id,
        }),
      ),
    )
    .handle("listRegisterReports", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        RegisterReports.listRegisterReports(token, {
          scope: scopeFromPath(params),
          after: query.after,
        }),
      ),
    ),
);

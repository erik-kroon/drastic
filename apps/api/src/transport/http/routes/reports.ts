import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Reports from "../../../application/reports";

export const ReportHandlers = HttpApiBuilder.group(Api, "reports", (handlers) =>
  handlers
    .handle("prepareReportFamily", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Reports.prepareReportFamily(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getReportFamily", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Reports.getReportFamily(token, { scope: scopeFromPath(params), reportId: params.id }),
      ),
    )
    .handle("compareReports", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Reports.compareReports(token, {
          scope: scopeFromPath(params),
          leftReportId: params.id,
          rightReportId: params.otherId,
          after: query.after,
        }),
      ),
    )
    .handle("listReports", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Reports.listReports(token, { scope: scopeFromPath(params), after: query.after }),
      ),
    )
    .handle("prepareReport", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Reports.prepareReport(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getReport", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Reports.getReport(token, { scope: scopeFromPath(params), reportId: params.id }),
      ),
    )
    .handle("reportLines", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Reports.reportLines(token, {
          scope: scopeFromPath(params),
          reportId: params.id,
          after: query.after,
        }),
      ),
    )
    .handle("reportGeneralLedger", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Reports.reportGeneralLedger(token, {
          scope: scopeFromPath(params),
          reportId: params.id,
          lineId: params.lineId,
          after: query.after,
        }),
      ),
    )
    .handle("reportExplanation", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Reports.reportExplanation(token, {
          scope: scopeFromPath(params),
          reportId: params.id,
          lineId: params.lineId,
          after: query.after,
        }),
      ),
    ),
);

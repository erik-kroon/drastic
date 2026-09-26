import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as Statements from "../../../application/report-statements";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const ReportStatementHandlers = HttpApiBuilder.group(Api, "reportStatements", (handlers) =>
  handlers
    .handle("prepareStatementSnapshot", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Statements.prepareStatementSnapshot(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listStatementSnapshots", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Statements.listStatementSnapshots(token, {
          scope: scopeFromPath(params),
          after: query.after,
        }),
      ),
    )
    .handle("getStatementSnapshot", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Statements.getStatementSnapshot(token, {
          scope: scopeFromPath(params),
          snapshotId: params.id,
          statement: query.statement,
          after: query.after,
        }),
      ),
    )
    .handle("explainStatementRow", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Statements.explainStatementRow(token, {
          scope: scopeFromPath(params),
          snapshotId: params.id,
          rowId: params.rowId,
          after: query.after,
        }),
      ),
    )
    .handle("compareStatementSnapshots", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Statements.compareStatementSnapshots(token, {
          scope: scopeFromPath(params),
          snapshotId: params.id,
          otherId: params.otherId,
          after: query.after,
        }),
      ),
    ),
);

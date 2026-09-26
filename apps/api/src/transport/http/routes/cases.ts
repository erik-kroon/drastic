import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Cases from "../../../application/cases";

export const CaseHandlers = HttpApiBuilder.group(Api, "cases", (handlers) =>
  handlers
    .handle("prepareCaseSnapshot", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Cases.prepareSnapshot(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listCases", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Cases.listCases(token, {
          scope: scopeFromPath(params),
          snapshotId: params.snapshotId,
          maxItems: query.maxItems,
          cursor: query.cursor,
        }),
      ),
    )
    .handle("getCaseContext", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Cases.getCaseContext(token, {
          scope: scopeFromPath(params),
          snapshotId: params.snapshotId,
          caseId: params.caseId,
          maxItems: query.maxItems,
          cursor: query.cursor,
          detail: query.detail,
        }),
      ),
    ),
);

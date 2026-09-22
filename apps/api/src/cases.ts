import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "./auth";
import { capabilities } from "./capabilities";

export const CaseHandlers = HttpApiBuilder.group(Api, "cases", (handlers) =>
  handlers
    .handle("prepareCaseSnapshot", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.cases_prepare_snapshot.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listCases", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.cases_list.execute(token, {
          scope: params,
          snapshotId: params.snapshotId,
          ...query,
        }),
      ),
    )
    .handle("getCaseContext", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.cases_get_context.execute(token, {
          scope: params,
          snapshotId: params.snapshotId,
          caseId: params.caseId,
          ...query,
        }),
      ),
    ),
);

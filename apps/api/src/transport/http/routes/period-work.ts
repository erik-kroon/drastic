import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";

import { Api } from "@open-erp/contracts/api";
import { capabilities } from "../../../application/capabilities";
import { scopeFromPath } from "../scope";
import { authenticate } from "../auth";
import { getPeriodWorkBatch, getPeriodWorkBatchResult } from "../../../application/period-work";

export const PeriodWorkHandlers = HttpApiBuilder.group(Api, "periodWork", (handlers) =>
  handlers
    .handle("getPeriodWorkBatch", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getPeriodWorkBatch(token, { scope: scopeFromPath(params), batchId: params.batchId }),
      ),
    )
    .handle("getPeriodWorkBatchResult", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getPeriodWorkBatchResult(token, {
          scope: scopeFromPath(params),
          batchId: params.batchId,
          key: params.key,
        }),
      ),
    )
    .handle("cancelPeriodWork", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.period_work_cancel.execute(token, {
          scope: scopeFromPath(params),
          manifestId: params.manifestId,
          idempotencyKey: headers["idempotency-key"],
          input: { expectedDigest: payload.expectedDigest },
        }),
      ),
    )
    .handle("preparePeriodWorkManifest", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.period_work_prepare_manifest.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getPeriodWorkProgress", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.period_work_get_progress.execute(token, {
          scope: scopeFromPath(params),
          manifestId: params.manifestId,
        }),
      ),
    )
    .handle("advancePeriodWork", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.period_work_advance.execute(token, {
          scope: scopeFromPath(params),
          manifestId: params.manifestId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("preparePeriodWorkBatch", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.period_work_prepare_batch.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approvePeriodWorkBatch", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.period_work_approve_batch.execute(token, {
          scope: scopeFromPath(params),
          batchId: params.batchId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executePeriodWorkBatch", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.period_work_execute_batch.execute(token, {
          scope: scopeFromPath(params),
          batchId: params.batchId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);

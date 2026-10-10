import { Api } from "@open-erp/contracts/api";
import { capabilities } from "../capabilities/index";
import { scopeFromPath } from "../operation-scope";

import { bindHttpOperation } from "../capabilities/http-operation";

export const PeriodWorkOperations = {
  executePeriodWorkBatch: bindHttpOperation(
    Api.groups.periodWork.endpoints.executePeriodWorkBatch,
    capabilities.period_work_execute_batch,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      batchId: params.batchId,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  approvePeriodWorkBatch: bindHttpOperation(
    Api.groups.periodWork.endpoints.approvePeriodWorkBatch,
    capabilities.period_work_approve_batch,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      batchId: params.batchId,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  preparePeriodWorkBatch: bindHttpOperation(
    Api.groups.periodWork.endpoints.preparePeriodWorkBatch,
    capabilities.period_work_prepare_batch,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  advancePeriodWork: bindHttpOperation(
    Api.groups.periodWork.endpoints.advancePeriodWork,
    capabilities.period_work_advance,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      manifestId: params.manifestId,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getPeriodWorkProgress: bindHttpOperation(
    Api.groups.periodWork.endpoints.getPeriodWorkProgress,
    capabilities.period_work_get_progress,
    ({ params }) => ({
      scope: scopeFromPath(params),
      manifestId: params.manifestId,
    }),
  ),
  preparePeriodWorkManifest: bindHttpOperation(
    Api.groups.periodWork.endpoints.preparePeriodWorkManifest,
    capabilities.period_work_prepare_manifest,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  cancelPeriodWork: bindHttpOperation(
    Api.groups.periodWork.endpoints.cancelPeriodWork,
    capabilities.period_work_cancel,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      manifestId: params.manifestId,
      idempotencyKey: headers["idempotency-key"],
      input: { expectedDigest: payload.expectedDigest },
    }),
  ),
  getPeriodWorkBatchResult: bindHttpOperation(
    Api.groups.periodWork.endpoints.getPeriodWorkBatchResult,
    capabilities.period_work_get_batch_result,
    ({ params }) => ({
      scope: scopeFromPath(params),
      batchId: params.batchId,
      key: params.key,
    }),
  ),
  getPeriodWorkBatch: bindHttpOperation(
    Api.groups.periodWork.endpoints.getPeriodWorkBatch,
    capabilities.period_work_get_batch,
    ({ params }) => ({ scope: scopeFromPath(params), batchId: params.batchId }),
  ),
};

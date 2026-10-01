import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  advancePeriodWork,
  approvePeriodWorkBatch,
  cancelPeriodWork,
  executePeriodWorkBatch,
  preparePeriodWorkBatch,
  preparePeriodWorkManifest,
  readPeriodWorkProgress,
  getPeriodWorkBatch,
  getPeriodWorkBatchResult,
} from "../period-work";

// Period-work mutations currently require an operator at the owning boundary.
// The MCP policy exposes progress reads; REST and the Bun runner use these same
// operations with their current admission checks.
export const periodWorkCapabilities = {
  period_work_get_batch: effectCapability(Capabilities.period_work_get_batch, getPeriodWorkBatch),
  period_work_get_batch_result: effectCapability(
    Capabilities.period_work_get_batch_result,
    getPeriodWorkBatchResult,
  ),
  period_work_prepare_manifest: effectCapability(
    Capabilities.period_work_prepare_manifest,
    preparePeriodWorkManifest,
  ),
  period_work_get_progress: effectCapability(
    Capabilities.period_work_get_progress,
    readPeriodWorkProgress,
  ),
  period_work_advance: effectCapability(Capabilities.period_work_advance, advancePeriodWork),
  period_work_cancel: effectCapability(Capabilities.period_work_cancel, (token, command) =>
    cancelPeriodWork(token, {
      scope: command.scope,
      manifestId: command.manifestId,
      idempotencyKey: command.idempotencyKey,
      expectedDigest: command.input.expectedDigest,
    }),
  ),
  period_work_prepare_batch: effectCapability(
    Capabilities.period_work_prepare_batch,
    (token, command) =>
      preparePeriodWorkBatch(token, {
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        ...command.input,
      }),
  ),
  period_work_approve_batch: effectCapability(
    Capabilities.period_work_approve_batch,
    (token, command) =>
      approvePeriodWorkBatch(token, {
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        batchId: command.batchId,
        ...command.input,
      }),
  ),
  period_work_execute_batch: effectCapability(
    Capabilities.period_work_execute_batch,
    (token, command) =>
      executePeriodWorkBatch(token, {
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        batchId: command.batchId,
        ...command.input,
      }),
  ),
};

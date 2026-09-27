import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  advancePeriodWork,
  approvePeriodWorkBatch,
  executePeriodWorkBatch,
  preparePeriodWorkBatch,
  preparePeriodWorkManifest,
  readPeriodWorkProgress,
} from "../period-work";

// NEXT-16. Preparation, review and progress are agent-reachable: they propose and
// record, and a prepared plan is still not a posted journal. The batch approval is
// not, because it is the human gesture, and a batch execution is not, because it
// posts.
export const periodWorkCapabilities = {
  period_work_prepare_manifest: effectCapability(
    Capabilities.period_work_prepare_manifest,
    preparePeriodWorkManifest,
  ),
  period_work_get_progress: effectCapability(
    Capabilities.period_work_get_progress,
    readPeriodWorkProgress,
  ),
  period_work_advance: effectCapability(Capabilities.period_work_advance, advancePeriodWork),
  period_work_prepare_batch: effectCapability(
    Capabilities.period_work_prepare_batch,
    preparePeriodWorkBatch,
  ),
  period_work_approve_batch: effectCapability(
    Capabilities.period_work_approve_batch,
    approvePeriodWorkBatch,
  ),
  period_work_execute_batch: effectCapability(
    Capabilities.period_work_execute_batch,
    executePeriodWorkBatch,
  ),
};

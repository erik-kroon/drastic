import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { getCaseContext, listCases, prepareSnapshot, resolveReviewTarget } from "../cases";
import {
  advanceRun,
  createPreparationRun,
  getPreparationRun,
  readPreparationJob,
  startPreparationJob,
  stopPreparationJob,
} from "../preparation-jobs";
import { getRule, getSimulation, proposeRule, simulateRule } from "../recurring-rules";

export const runCaseCapabilities = {
  runs_stop_background: effectCapability(Capabilities.runs_stop_background, stopPreparationJob),
  runs_start_background: effectCapability(Capabilities.runs_start_background, startPreparationJob),
  runs_get_background: effectCapability(Capabilities.runs_get_background, readPreparationJob),
  rules_propose: effectCapability(Capabilities.rules_propose, proposeRule),
  rules_get: effectCapability(Capabilities.rules_get, getRule),
  rules_simulate: effectCapability(Capabilities.rules_simulate, simulateRule),
  rules_get_simulation: effectCapability(Capabilities.rules_get_simulation, getSimulation),
  runs_create_preparation: effectCapability(
    Capabilities.runs_create_preparation,
    createPreparationRun,
  ),
  runs_get: effectCapability(Capabilities.runs_get, getPreparationRun),
  runs_advance: effectCapability(Capabilities.runs_advance, advanceRun),
  cases_prepare_snapshot: effectCapability(Capabilities.cases_prepare_snapshot, prepareSnapshot),
  cases_list: effectCapability(Capabilities.cases_list, listCases),
  cases_get_context: effectCapability(Capabilities.cases_get_context, getCaseContext),
  cases_resolve_review: effectCapability(Capabilities.cases_resolve_review, resolveReviewTarget),
};

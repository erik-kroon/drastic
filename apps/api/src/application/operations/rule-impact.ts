import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { captureImpact, decideTarget, recordNotice } from "../closing/rule-impact";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const RuleImpactOperations = {
  listRuleImpactDecisions: bindHttpOperation(
    Api.groups.ruleImpact.endpoints.listRuleImpactDecisions,
    capabilities.rules_list_impact_decisions,
    ({ params }) => ({ scope: scopeFromPath(params), noticeId: params.noticeId }),
  ),
  decideRuleImpact: defineHttpOperation(
    Api.groups.ruleImpact.endpoints.decideRuleImpact,
    (token, { params, headers, payload }) =>
      decideTarget(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        snapshotId: params.snapshotId,
        input: payload,
      }),
  ),
  getRuleImpactSnapshot: bindHttpOperation(
    Api.groups.ruleImpact.endpoints.getRuleImpactSnapshot,
    capabilities.rules_get_impact_snapshot,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      snapshotId: params.snapshotId,
      after: query.after,
    }),
  ),
  listRuleImpact: bindHttpOperation(
    Api.groups.ruleImpact.endpoints.listRuleImpact,
    capabilities.rules_list_impact,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  captureRuleImpact: defineHttpOperation(
    Api.groups.ruleImpact.endpoints.captureRuleImpact,
    (token, { params, headers, payload }) =>
      captureImpact(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        noticeId: params.noticeId,
        periodFrom: payload.periodFrom,
        periodTo: payload.periodTo,
      }),
  ),
  recordRuleChangeNotice: defineHttpOperation(
    Api.groups.ruleImpact.endpoints.recordRuleChangeNotice,
    (token, { params, headers, payload }) =>
      recordNotice(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  listRuleChangeNotices: bindHttpOperation(
    Api.groups.ruleImpact.endpoints.listRuleChangeNotices,
    capabilities.rules_list_change_notices,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
};
